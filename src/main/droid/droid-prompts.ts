// What Droid asks of the person, each held as the JSON-RPC request it is until a person answers it,
// a Stop withdraws it, or the child goes. An answer claims the request, commits the journal
// compare-and-set while the claim is held, and only then replies, so a second client loses the
// commit and Droid hears exactly one answer.

import type { AgentSessionPromptResponse } from '../../shared/agent-session-question-answer'
import { JSON_RPC_METHOD_NOT_FOUND } from '../acp/acp-errors'
import type { JsonlRpcTimelineLane } from '../jsonl-rpc/timeline-lane'
import {
  AgentSessionPromptAnswerRejectedError,
  AgentSessionPromptUnavailableError
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { DroidRequestContext } from './droid-json-rpc-peer'
import { droidPermissionPresentation } from './droid-permission-requests'
import { droidPickOptionsPresentation } from './droid-pick-options-requests'
import type { DroidPromptEnvironment, DroidPromptPresentation } from './droid-prompt-presentation'
import { droidQuestionPresentation } from './droid-question-requests'
import { DroidRpcError } from './droid-rpc-errors'

const PRESENTERS = new Map<
  string,
  (params: unknown, environment: DroidPromptEnvironment) => DroidPromptPresentation
>([
  ['droid.request_permission', droidPermissionPresentation],
  ['droid.ask_user', droidQuestionPresentation],
  ['droid.pick_options', droidPickOptionsPresentation]
])

type OpenRequest = {
  key: string
  /** The journal request the card on show is under. A longer request shows one card after another. */
  cardKey: string
  cardCount: number
  presentation: DroidPromptPresentation
  signal: AbortSignal
  claimed: boolean
  /** A Stop landed while an answer was being saved: a failed save, or a next card, withdraws it. */
  withdrawing: boolean
  settle: (reply: unknown) => void
}

export class DroidPrompts {
  private readonly open = new Map<string, OpenRequest>()

  constructor(
    private readonly lane: JsonlRpcTimelineLane,
    private readonly environment: DroidPromptEnvironment
  ) {}

  /** The peer's handler for a request Droid makes: a card, answered when a person chooses. */
  handle(method: string, params: unknown, context: DroidRequestContext): Promise<unknown> {
    const present = PRESENTERS.get(method)
    if (!present) {
      throw new DroidRpcError(
        JSON_RPC_METHOD_NOT_FOUND,
        `Unsupported Droid client method: ${method}`
      )
    }
    const presentation = present(params, this.environment)
    const key = `${method}:${context.id}`
    this.lane.apply([{ type: 'request.open', request: key, body: presentation.body }])
    return new Promise((resolve) => {
      const entry: OpenRequest = {
        key,
        cardKey: key,
        cardCount: 1,
        presentation,
        signal: context.signal,
        claimed: false,
        withdrawing: false,
        settle: (reply) => {
          if (this.open.get(key) === entry) {
            this.open.delete(key)
          }
          resolve(reply)
        }
      }
      this.open.set(key, entry)
      // The connection closed: nobody can answer, and an answer already being saved finishes.
      context.signal.addEventListener(
        'abort',
        () => {
          if (this.open.get(key) === entry && !entry.claimed) {
            this.withdraw(entry)
          }
        },
        { once: true }
      )
    })
  }

  /** `response` null is a dismissal. Without `answer`, Droid is left waiting for the child to end. */
  async respond(
    itemId: string,
    response: AgentSessionPromptResponse | null,
    commit: () => Promise<void>,
    answer = true
  ): Promise<void> {
    const entry = this.find(itemId)
    if (!entry) {
      throw new AgentSessionPromptUnavailableError(itemId)
    }
    let reply: unknown
    let nextCard: DroidPromptPresentation | undefined
    try {
      if (response && entry.presentation.advance) {
        nextCard = entry.presentation.advance(response)
      } else {
        reply = entry.presentation.reply(response)
      }
    } catch (error) {
      throw new AgentSessionPromptAnswerRejectedError(
        error instanceof Error ? error.message : String(error)
      )
    }
    entry.claimed = true
    try {
      await commit()
    } catch (error) {
      entry.claimed = false
      if (entry.signal.aborted || entry.withdrawing) {
        this.withdraw(entry)
      }
      throw error
    }
    if (nextCard) {
      this.showNextCard(entry, nextCard)
    } else if (answer) {
      entry.settle(reply)
    } else {
      this.open.delete(entry.key)
    }
  }

  /** A Stop: Droid hears its refusal to everything no answer has claimed. */
  withdrawAll(): void {
    for (const entry of this.open.values()) {
      if (entry.claimed) {
        entry.withdrawing = true
      } else {
        this.withdraw(entry)
      }
    }
  }

  /** The child is gone: nobody can answer for it any more. */
  clear(): void {
    this.open.clear()
  }

  private showNextCard(entry: OpenRequest, card: DroidPromptPresentation): void {
    // Nobody is left to answer a closed connection, and a Stop that landed while the answer was
    // being saved ends the questionnaire.
    if (entry.signal.aborted || entry.withdrawing) {
      this.withdraw(entry)
      return
    }
    entry.cardCount += 1
    entry.cardKey = `${entry.key}:card-${entry.cardCount}`
    entry.presentation = card
    entry.claimed = false
    this.lane.apply([{ type: 'request.open', request: entry.cardKey, body: card.body }])
  }

  private withdraw(entry: OpenRequest): void {
    entry.settle(entry.presentation.reply(null))
    this.lane.apply([{ type: 'request.withdrawn', request: entry.cardKey }])
  }

  private find(itemId: string): OpenRequest | null {
    for (const entry of this.open.values()) {
      if (!entry.claimed && this.lane.isRequestRow(itemId, entry.cardKey)) {
        return entry
      }
    }
    return null
  }
}
