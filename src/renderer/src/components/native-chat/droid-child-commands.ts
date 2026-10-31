import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import {
  AGENT_SESSION_CONVERSATION_NAME_MAX_LENGTH,
  normalizeAgentSessionConversationName
} from '../../../../shared/agent-session-conversation-name'
import type { DroidChildCommandName } from '../../../../shared/droid-command-registry'
import type { DroidFreshSessionSettings } from '../../../../shared/droid-fresh-session-settings'
import {
  DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH,
  type DroidHostCommand,
  type DroidHostCommandResult
} from '../../../../shared/droid-host-command'
import type { StructuredAgentSessionCommandOutcome } from '../../../../shared/structured-agent-session-composer'
import {
  droidCommandFailureWords,
  droidContextWords,
  droidCreditsWords
} from './droid-child-command-words'
import {
  cwdHostCommand,
  cwdRefusal,
  cwdWords,
  skillsHostCommand,
  skillsRefusal,
  skillsWords
} from './droid-cwd-and-skills-commands'
import { switchDroidSessionWithNotice } from './droid-session-switch-notice'

type DroidChildCommandOutcome = Omit<StructuredAgentSessionCommandOutcome, 'handled'>

export type DroidChildCommandChat = {
  tabId: string
  sessionId: string
  target: RuntimeClientTarget
  /** What the tab runs on now, so a session that /compress, /fork or a rewind opens keeps it. */
  keptSettings: () => DroidFreshSessionSettings
  /** Names this tab as the person did, so a title Droid reports later does not replace it. */
  renameTab: (title: string) => void
  /** The chat's own rewind, which holds the journal and the confirmation /rewind-conversation needs. */
  rewindConversation?: () => Promise<DroidChildCommandOutcome>
}

/** Commands an older server's schema refuses without a sentence of its own. */
const ADDED_AFTER_FIRST_SERVERS: readonly DroidChildCommandName[] = [
  'fork',
  'rename',
  'cwd',
  'cd',
  'skills'
]

/** Chats with a /compress under way: a summary is a model call, and a second would stack on it. */
const compressing = new Set<string>()

// A rewind names a row of the chat and runs from the chat's own rewind, never from here.
type AskedCommandName = Exclude<DroidChildCommandName, 'rewind-conversation'>
type AskedCommandResult = Exclude<DroidHostCommandResult, { name: 'rewind' }>

function hostCommand(name: AskedCommandName, argument: string): DroidHostCommand {
  switch (name) {
    case 'context':
      return { name: 'context' }
    case 'cost':
      return { name: 'credits' }
    case 'fork':
      return { name: 'fork' }
    case 'rename':
      return { name: 'rename', title: normalizeAgentSessionConversationName(argument) ?? '' }
    case 'compress':
      return argument ? { name: 'compress', instructions: argument } : { name: 'compress' }
    case 'cwd':
    case 'cd':
      return cwdHostCommand(argument)
    case 'skills':
      // A request the refusal turned away never gets here.
      return skillsHostCommand(argument) ?? { name: 'skills' }
  }
}

function moveToCompressedSession(chat: DroidChildCommandChat, droidSessionId: string): void {
  void switchDroidSessionWithNotice(
    {
      fromTabId: chat.tabId,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId, settings: chat.keptSettings() }
    },
    {
      // The earlier tab, and the chat row that says what happened, is closed by now.
      opened: () =>
        translate(
          'components.native-chat.droidChildCommands.compressMoved',
          'Conversation compressed into a new Droid session. The earlier session stays in Session History.'
        ),
      failed: () =>
        translate(
          'components.native-chat.droidChildCommands.compressMoveFailed',
          'Droid compressed the conversation into a new session, but Orca could not open it. The earlier session stays in Session History.'
        )
    }
  )
}

function openFork(chat: DroidChildCommandChat, droidSessionId: string): void {
  void switchDroidSessionWithNotice(
    {
      fromTabId: chat.tabId,
      placement: 'beside',
      target: { kind: 'existing', droidSessionId, settings: chat.keptSettings() }
    },
    {
      failed: () =>
        translate(
          'components.native-chat.droidChildCommands.forkOpenFailed',
          'Droid forked the conversation, but Orca could not open the fork. This chat is still on the original session.'
        )
    }
  )
}

function outcomeOf(
  chat: DroidChildCommandChat,
  result: AskedCommandResult
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
    case 'fork': {
      // The tab stays on the original session; the person opens the fork when they want it.
      const { newSessionId } = result
      return {
        accepted: true,
        error: null,
        info: translate(
          'components.native-chat.droidChildCommands.forked',
          'Forked this conversation. This chat stays on the original session.'
        ),
        infoAction: {
          label: translate('components.native-chat.droidChildCommands.forkOpen', 'Open fork'),
          onClick: () => openFork(chat, newSessionId)
        }
      }
    }
    case 'rename':
      // The tab is named only once Droid has taken the title, so a refusal leaves both as they were.
      chat.renameTab(result.title)
      return {
        accepted: true,
        error: null,
        info: translate(
          'components.native-chat.droidChildCommands.renamed',
          'Renamed this chat to “{{title}}”.',
          { title: result.title }
        )
      }
    case 'cwd':
      return { accepted: true, error: null, info: cwdWords(result.resolvedPath) }
    case 'skills':
      return { accepted: true, error: null, info: skillsWords(result) }
  }
}

function renameRefusal(argument: string): string | null {
  if (normalizeAgentSessionConversationName(argument) === null) {
    return translate(
      'components.native-chat.droidChildCommands.renameUsage',
      'Use /rename followed by a title, for example /rename Fix the login redirect.'
    )
  }
  // The shared normalizer cuts an over-long name silently, so the cap is checked on the spaced-out text first.
  return argument.replace(/\s+/g, ' ').trim().length > AGENT_SESSION_CONVERSATION_NAME_MAX_LENGTH
    ? translate(
        'components.native-chat.droidChildCommands.renameTooLong',
        'Keep the /rename title under {{max}} characters.',
        { max: String(AGENT_SESSION_CONVERSATION_NAME_MAX_LENGTH) }
      )
    : null
}

function refusal(name: DroidChildCommandName, argument: string): string | null {
  if (name === 'rename') {
    return renameRefusal(argument)
  }
  if (name === 'cwd' || name === 'cd') {
    return cwdRefusal(name, argument)
  }
  if (name === 'skills') {
    return skillsRefusal(argument)
  }
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

/** `/context`, `/cost`, `/compress`, `/fork`, `/rename`, `/cwd`, `/cd`, `/skills` and `/rewind-conversation`: none sends a message. */
export async function runDroidChildCommand(
  chat: DroidChildCommandChat,
  name: DroidChildCommandName,
  argument: string
): Promise<DroidChildCommandOutcome> {
  const refused = refusal(name, argument)
  if (refused) {
    return { accepted: false, error: refused }
  }
  if (name === 'rewind-conversation') {
    return (
      chat.rewindConversation?.() ?? {
        accepted: false,
        error: translate(
          'components.native-chat.droidChildCommands.rewindUnavailable',
          'This chat cannot rewind.'
        )
      }
    )
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
    const result = await callStructuredAgentSession<AskedCommandResult>(
      chat.target,
      'agentSession.droidCommand',
      { sessionId: chat.sessionId, command: hostCommand(name, argument) }
    )
    return outcomeOf(chat, result)
  } catch (error) {
    // The host words a method Droid lacks itself; an older server refuses a command it never heard of.
    return {
      accepted: false,
      error: droidCommandFailureWords(error, name, ADDED_AFTER_FIRST_SERVERS.includes(name))
    }
  } finally {
    compressing.delete(chat.sessionId)
  }
}
