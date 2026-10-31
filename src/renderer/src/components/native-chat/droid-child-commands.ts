import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { switchDroidChatSession } from '@/lib/droid-chat-session-switch'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import type { DroidChildCommandName } from '../../../../shared/droid-command-registry'
import type { DroidFreshSessionSettings } from '../../../../shared/droid-fresh-session-settings'
import {
  DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH,
  type DroidHostCommand,
  type DroidHostCommandResult
} from '../../../../shared/droid-host-command'
import type { StructuredAgentSessionCommandOutcome } from '../../../../shared/structured-agent-session-composer'
import { droidContextWords, droidCreditsWords } from './droid-child-command-words'

type DroidChildCommandOutcome = Omit<StructuredAgentSessionCommandOutcome, 'handled'>

export type DroidChildCommandChat = {
  tabId: string
  sessionId: string
  target: RuntimeClientTarget
  /** What the tab runs on now, so a session that /compress moves to keeps it. */
  keptSettings: () => DroidFreshSessionSettings
}

/** Chats with a /compress under way: a summary is a model call, and a second would stack on it. */
const compressing = new Set<string>()

function hostCommand(name: DroidChildCommandName, argument: string): DroidHostCommand {
  if (name === 'context') {
    return { name: 'context' }
  }
  if (name === 'cost') {
    return { name: 'credits' }
  }
  return argument ? { name: 'compress', instructions: argument } : { name: 'compress' }
}

function moveToCompressedSession(chat: DroidChildCommandChat, droidSessionId: string): void {
  const failed = (): void => {
    toast.error(
      translate(
        'components.native-chat.droidChildCommands.compressMoveFailed',
        'Droid compressed the conversation into a new session, but Orca could not open it. The earlier session stays in Session History.'
      )
    )
  }
  try {
    const { settlement } = switchDroidChatSession({
      fromTabId: chat.tabId,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId, settings: chat.keptSettings() }
    })
    void settlement.then((settled) => {
      if (settled.kind === 'structured') {
        // The earlier tab, and the chat row that says what happened, is closed by now.
        toast(
          translate(
            'components.native-chat.droidChildCommands.compressMoved',
            'Conversation compressed into a new Droid session. The earlier session stays in Session History.'
          )
        )
      } else if (settled.kind === 'failed' && !settled.notified) {
        failed()
      }
    }, failed)
  } catch {
    failed()
  }
}

function outcomeOf(
  chat: DroidChildCommandChat,
  result: DroidHostCommandResult
): DroidChildCommandOutcome {
  switch (result.name) {
    case 'context':
      return result.report
        ? { accepted: true, error: null, info: droidContextWords(result.report) }
        : {
            accepted: false,
            error: translate(
              'components.native-chat.droidChildCommands.contextUnreadable',
              'Droid did not report its context usage. Try again.'
            )
          }
    case 'credits':
      return { accepted: true, error: null, info: droidCreditsWords(result.factoryCredits) }
    case 'compress':
      // The words are the chat row the host wrote; a different id moves the tab, the same one leaves it.
      if (result.newSessionId !== null) {
        moveToCompressedSession(chat, result.newSessionId)
      }
      return { accepted: true, error: null }
  }
}

function refusal(name: DroidChildCommandName, argument: string): string | null {
  if (name !== 'compress') {
    return argument
      ? translate(
          'components.native-chat.droidSessionCommands.noArguments',
          'Use /{{name}} without arguments.',
          { name }
        )
      : null
  }
  return argument.length > DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH
    ? translate(
        'components.native-chat.droidChildCommands.compressTooLong',
        'Keep the /compress instructions under {{max}} characters.',
        { max: String(DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH) }
      )
    : null
}

/** `/context`, `/cost` and `/compress`: each is asked of the Droid child and sends no message. */
export async function runDroidChildCommand(
  chat: DroidChildCommandChat,
  name: DroidChildCommandName,
  argument: string
): Promise<DroidChildCommandOutcome> {
  const refused = refusal(name, argument)
  if (refused) {
    return { accepted: false, error: refused }
  }
  if (name === 'compress') {
    if (compressing.has(chat.sessionId)) {
      return {
        accepted: false,
        error: translate(
          'components.native-chat.droidChildCommands.compressBusy',
          'Droid is still compressing this conversation.'
        )
      }
    }
    compressing.add(chat.sessionId)
  }
  try {
    const result = await callStructuredAgentSession<DroidHostCommandResult>(
      chat.target,
      'agentSession.droidCommand',
      { sessionId: chat.sessionId, command: hostCommand(name, argument) }
    )
    return outcomeOf(chat, result)
  } catch (error) {
    // The host words a method Droid lacks, and an older host, itself.
    const words = error instanceof Error ? error.message.trim() : ''
    return {
      accepted: false,
      error:
        words ||
        translate(
          'components.native-chat.droidChildCommands.failed',
          'Could not run /{{name}}. Try again.',
          { name }
        )
    }
  } finally {
    compressing.delete(chat.sessionId)
  }
}
