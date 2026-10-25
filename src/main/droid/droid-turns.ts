import { agentSessionFailureFact, providerDiagnostic } from '../../shared/agent-session-failure'
import { agentSessionFailureWords } from '../../shared/agent-session-failure-words'
import type { JsonlRpcTimelineLane } from '../jsonl-rpc/timeline-lane'
import { DISPATCH_DOUBT_PROVIDER_ENDED_UNANSWERED } from '../native-chat/agent-session-journal/journal-dispatch-doubt-reasons'
import type { AgentSessionDispatchOutcome } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { DroidMessages } from './droid-messages'
import { DroidRpcError } from './droid-rpc-errors'
import { parseDroidNotification, type DroidNotification } from './droid-session-notifications'

const MAX_PENDING_SENDS = 128

export type DroidTurnDeps = {
  lane: JsonlRpcTimelineLane
  generation: string
  request: (
    method: string,
    params: unknown,
    options?: { timeoutMs?: number | null; onId?: (id: string) => void }
  ) => Promise<unknown>
  settled: (id: string, outcome: AgentSessionDispatchOutcome) => void
  idle: () => void
  /** Droid's report of the session's settings; it belongs to the session, not to a turn. */
  settings: (report: { requestId?: string; settings: unknown }) => void
  /** The echo's message id, recorded before the timeline admits the send. */
  rememberEcho?: (clientMessageId: string, messageId: string) => void
  warn?: (message: string, fields: { requestId: string }) => void
}

type Send = { id: string; at: number; requestId?: string; accepted: boolean }

/** Droid answers a send with an empty result; the send is accepted when Droid echoes it as a user
 *  message carrying the request's id, and a turn is whatever runs between leaving idle and the
 *  `agent_turn_completed` that says why it ended. */
export class DroidTurns {
  private readonly messages: DroidMessages
  private readonly sends = new Set<Send>()
  private readonly byRequest = new Map<string, Send>()
  private turn = 0
  private active?: string
  private stopped = false
  private ended = false
  private lastError?: string

  constructor(private readonly deps: DroidTurnDeps) {
    this.messages = new DroidMessages(deps.generation)
  }

  get holdsDispatch(): boolean {
    return this.sends.size > 0
  }
  get working(): boolean {
    return this.active !== undefined
  }

  async submit(
    id: string,
    at: number,
    params: { text: string },
    before?: () => Promise<void>
  ): Promise<AgentSessionDispatchOutcome> {
    if (this.ended) {
      throw new Error('Droid session ended before dispatch')
    }
    if (this.sends.size >= MAX_PENDING_SENDS) {
      return {
        state: 'rejected',
        ...agentSessionFailureWords(agentSessionFailureFact('queueFull'), {
          agentName: 'Droid',
          surface: 'rejection'
        })
      }
    }
    const send: Send = { id, at, accepted: false }
    this.sends.add(send)
    if (before) {
      // Registered first, so a Stop that lands while this waits sees a send in flight.
      try {
        await before()
      } catch (error) {
        this.forget(send)
        throw error
      }
      if (this.ended) {
        throw new Error('Droid session ended before dispatch')
      }
    }
    try {
      await this.deps.request(
        'droid.add_user_message',
        this.working ? { ...params, queuePlacement: 'end_of_turn' } : params,
        {
          onId: (requestId) => {
            send.requestId = requestId
            this.byRequest.set(requestId, send)
          }
        }
      )
      return { state: 'admitted' }
    } catch (error) {
      if (send.accepted) {
        return { state: 'admitted' }
      }
      this.forget(send)
      if (error instanceof DroidRpcError) {
        const fact = agentSessionFailureFact('providerRejected', {
          detail: providerDiagnostic(error.message, 'person')
        })
        return {
          state: 'rejected',
          ...agentSessionFailureWords(fact, { agentName: 'Droid', surface: 'rejection' })
        }
      }
      return { state: 'unknown', reason: 'Droid did not confirm the message' }
    }
  }

  /** `droid.session_notification` params. Throws on a notification it reads but cannot parse. */
  receive(params: unknown): void {
    if (this.ended) {
      return
    }
    const notification = parseDroidNotification(params)
    const { lane } = this.deps
    switch (notification.type) {
      case 'droid_working_state_changed':
        if (notification.newState !== 'idle') {
          this.open(Date.now())
        }
        return
      case 'create_message':
        this.message(notification)
        return
      case 'queued_messages_discarded':
        this.discard(notification)
        return
      case 'assistant_text_delta':
      case 'thinking_text_delta':
        lane.apply(this.messages.delta(notification))
        return
      case 'assistant_text_complete':
      case 'thinking_text_complete':
        lane.apply(this.messages.complete(notification))
        return
      case 'tool_call':
        lane.apply(this.messages.toolCall(notification))
        return
      case 'tool_result':
        lane.apply(this.messages.toolResult(notification))
        return
      case 'error':
        this.lastError = notification.message ?? notification.error?.message
        return
      case 'agent_turn_completed':
        this.finish(notification.reason)
        break
      case 'settings_updated':
        this.deps.settings({
          settings: notification.settings,
          ...(notification.requestId ? { requestId: notification.requestId } : {})
        })
        break
      case 'other':
        break
    }
  }

  stop(): void {
    this.stopped = true
  }

  end(): void {
    this.ended = true
    this.releaseUnanswered('Droid ended before confirming delivery')
  }

  private message(notification: Extract<DroidNotification, { type: 'create_message' }>): void {
    const { message, requestId } = notification
    if (message.visibility === 'llm_only') {
      return
    }
    if (message.role === 'assistant') {
      this.deps.lane.apply(this.messages.snapshot(message))
      return
    }
    const send = message.role === 'user' && requestId ? this.byRequest.get(requestId) : undefined
    if (send) {
      this.accept(send, message.id)
    }
  }

  /** The frame's text is ignored: nothing returns to the composer, and a second notice changes nothing. */
  private discard(
    notification: Extract<DroidNotification, { type: 'queued_messages_discarded' }>
  ): void {
    const { requestId } = notification
    const send = requestId ? this.byRequest.get(requestId) : undefined
    if (!send) {
      this.deps.warn?.('Droid discarded a message that was not waiting', {
        requestId: requestId ?? ''
      })
      return
    }
    this.forget(send)
    this.deps.settled(send.id, {
      state: 'rejected',
      ...agentSessionFailureWords(agentSessionFailureFact('cancelled'), { surface: 'rejection' })
    })
  }

  private accept(send: Send, messageId: string): void {
    send.accepted = true
    this.forget(send)
    this.deps.rememberEcho?.(send.id, messageId)
    this.open(Date.now())
    this.deps.lane.apply([
      { type: 'input.accepted', clientMessageId: send.id, requestedAt: send.at }
    ])
  }

  private forget(send: Send): void {
    this.sends.delete(send)
    if (send.requestId) {
      this.byRequest.delete(send.requestId)
    }
  }

  private open(at: number): void {
    if (this.active) {
      return
    }
    this.active = `run:${this.deps.generation}:${++this.turn}`
    this.stopped = false
    this.lastError = undefined
    this.deps.lane.apply([{ type: 'turn.open', turn: this.active, at }])
  }

  private finish(reason: string): void {
    this.open(Date.now())
    const cancelled = this.stopped || reason === 'cancelled'
    const outcome = cancelled ? 'cancellation' : reason === 'completed' ? 'success' : 'failure'
    const events = this.messages.settle()
    if (outcome === 'failure') {
      const fact = agentSessionFailureFact(
        reason === 'model_authentication_failed' ? 'notSignedIn' : 'providerRejected',
        {
          detail: providerDiagnostic(this.lastError ?? `Droid ended the turn (${reason})`, 'person')
        }
      )
      events.push({
        type: 'item.close',
        item: `error:${this.active}`,
        body: {
          kind: 'status',
          tone: 'error',
          ...agentSessionFailureWords(fact, { agentName: 'Droid', surface: 'row' })
        }
      })
    }
    events.push({
      type: 'turn.end',
      at: Date.now(),
      state: cancelled ? 'interrupted' : 'completed',
      outcome
    })
    this.deps.lane.apply(events)
    this.active = undefined
    this.lastError = undefined
    // No echo and no discard is doubt, never a withdrawal.
    this.releaseUnanswered(DISPATCH_DOUBT_PROVIDER_ENDED_UNANSWERED)
    this.deps.idle()
  }

  private releaseUnanswered(reason: string): void {
    for (const send of this.sends) {
      if (!send.accepted) {
        this.deps.settled(send.id, { state: 'unknown', reason })
      }
      this.forget(send)
    }
  }
}
