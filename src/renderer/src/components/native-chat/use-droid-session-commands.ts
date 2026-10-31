import { useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { switchDroidChatSession } from '@/lib/droid-chat-session-switch'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import type { AgentType } from '../../../../shared/agent-status-types'
import {
  isDroidChildCommandName,
  type DroidChildCommandName,
  type DroidHostCommandName
} from '../../../../shared/droid-command-registry'
import {
  DROID_NEW_SESSION_SETTINGS,
  droidSettingsKeptByClear,
  type DroidFreshSessionSettings
} from '../../../../shared/droid-fresh-session-settings'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat-session-options'
import type { StructuredAgentSessionCommandOutcome } from '../../../../shared/structured-agent-session-composer'
import { runDroidChildCommand, type DroidChildCommandChat } from './droid-child-commands'

// The commands answered by the Droid child are never asked twice.
type SessionCommandName = Exclude<DroidHostCommandName, 'help' | DroidChildCommandName>
type SessionCommandOutcome = Omit<StructuredAgentSessionCommandOutcome, 'handled'>

// Typed by the registry's names, so a command registered there does not compile until it is asked.
const ASKS: Record<SessionCommandName, () => string> = {
  clear: () =>
    translate(
      'components.native-chat.droidSessionCommands.confirmClear',
      'Run /clear again to start a new session that keeps these settings. This session stays in Session History.'
    ),
  new: () =>
    translate(
      'components.native-chat.droidSessionCommands.confirmNew',
      'Run /new again to start a new session with the settings of a new chat. This session stays in Session History.'
    ),
  quit: () => askToClose('quit'),
  exit: () => askToClose('exit')
}

function askToClose(name: 'quit' | 'exit'): string {
  return translate(
    'components.native-chat.droidSessionCommands.confirmClose',
    'Run /{{name}} again to close this chat. It stays in Session History.',
    { name }
  )
}

function isSessionCommand(name: string): name is SessionCommandName {
  return Object.keys(ASKS).includes(name)
}

function startFreshSession(
  tabId: string,
  settings: DroidFreshSessionSettings
): SessionCommandOutcome {
  const failed = (): void => {
    toast.error(
      translate(
        'components.native-chat.droidSessionCommands.failed',
        'Could not start the new Droid session. This chat is still open.'
      )
    )
  }
  try {
    const { settlement } = switchDroidChatSession({
      fromTabId: tabId,
      placement: 'replace',
      target: { kind: 'fresh', settings }
    })
    void settlement.then((settled) => {
      if (settled.kind === 'failed' && !settled.notified) {
        failed()
      }
    }, failed)
    return { accepted: true, error: null }
  } catch {
    failed()
    return { accepted: false, error: null }
  }
}

export type DroidSessionCommands = {
  /** Called with every submit, ahead of the dispatch: an ask stands only for the same command again. */
  noteSubmit: (text: string) => void
  /** Null leaves the command to the shared handling. */
  runHostCommand: (name: string, argument: string) => Promise<SessionCommandOutcome | null>
}

/**
 * `/clear`, `/new`, `/quit` and `/exit` of a Droid chat. Each asks again and acts on the second
 * submit of the same command: the TUI quits on one Enter, but a press here ends a chat.
 * `/context`, `/cost`, `/compress`, `/fork` and `/rewind-conversation` answer on the first submit.
 */
export function useDroidSessionCommands(args: {
  tabId: string
  sessionId: string
  target: RuntimeClientTarget
  agent: AgentType
  optionSnapshot: readonly SessionOptionDescriptor[]
  optionSurface: Pick<SessionOptionsSurface, 'specPair' | 'autonomy'> | undefined
  /** The chat's own rewind, which holds the confirmation `/rewind-conversation` asks. */
  rewindConversation?: DroidChildCommandChat['rewindConversation']
}): DroidSessionCommands | undefined {
  const { tabId, sessionId, target, agent, optionSnapshot, optionSurface, rewindConversation } =
    args
  const asked = useRef<SessionCommandName | null>(null)
  return useMemo((): DroidSessionCommands | undefined => {
    if (agent !== 'droid') {
      return undefined
    }
    return {
      noteSubmit: (text) => {
        if (asked.current && text.trim().toLowerCase() !== `/${asked.current}`) {
          asked.current = null
        }
      },
      runHostCommand: async (name, argument) => {
        if (isDroidChildCommandName(name)) {
          asked.current = null
          return runDroidChildCommand(
            {
              tabId,
              sessionId,
              target,
              keptSettings: () => droidSettingsKeptByClear(optionSnapshot, optionSurface),
              ...(rewindConversation ? { rewindConversation } : {})
            },
            name,
            argument
          )
        }
        if (!isSessionCommand(name)) {
          return null
        }
        if (argument) {
          return {
            accepted: false,
            error: translate(
              'components.native-chat.droidSessionCommands.noArguments',
              'Use /{{name}} without arguments.',
              { name }
            )
          }
        }
        if (asked.current !== name) {
          asked.current = name
          return { accepted: false, error: null, info: ASKS[name]() }
        }
        asked.current = null
        if (name === 'quit' || name === 'exit') {
          // The tab's own close ends the Droid child; closing it never says the chat was cleared.
          useAppStore.getState().closeUnifiedTab(tabId)
          return { accepted: true, error: null }
        }
        return startFreshSession(
          tabId,
          name === 'clear'
            ? droidSettingsKeptByClear(optionSnapshot, optionSurface)
            : DROID_NEW_SESSION_SETTINGS
        )
      }
    }
  }, [agent, optionSnapshot, optionSurface, rewindConversation, sessionId, tabId, target])
}
