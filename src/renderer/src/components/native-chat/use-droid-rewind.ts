import { useCallback, useContext, useLayoutEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import {
  ConfirmationDialogContext,
  type ConfirmationDialogContextValue
} from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import type { AgentJournalSubmission } from '../../../../shared/agent-session-journal-types'
import { droidSettingsKeptByClear } from '../../../../shared/droid-fresh-session-settings'
import type { DroidHostCommandResult } from '../../../../shared/droid-host-command'
import { droidMessageIdOfJournalItem } from '../../../../shared/droid-rewind-message-id'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat-session-options'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { droidCommandFailureWords } from './droid-child-command-words'
import { switchDroidSessionWithNotice } from './droid-session-switch-notice'
import { nativeChatRowOffersRewind } from './native-chat-rewind-eligibility'
import type { NativeChatStructuredViewProps } from './native-chat-view-types'
import type { NativeChatRewindSurface } from './use-native-chat-rewind'

/** What a rewind reads of the chat, at the moment it asks and again when the person has answered. */
export type DroidRewindChat = {
  messages: readonly NativeChatMessage[]
  submissions: readonly Pick<
    AgentJournalSubmission,
    'clientMessageId' | 'dispatchState' | 'providerItemId'
  >[]
  optionSnapshot: readonly SessionOptionDescriptor[]
  optionSurface: Pick<SessionOptionsSurface, 'specPair' | 'autonomy'> | undefined
  isWorking: boolean
  sendOut: boolean
  prompts: readonly unknown[]
  backgroundTasks: { isMonitoring: boolean }
  queuedMessages: { cards: readonly unknown[] }
}

type RewindOutcome = { accepted: boolean; error: string | null }

export type DroidRewind = {
  /** "Rewind to here" on a message, in place of the Codex-shaped surface a Droid chat never gets. */
  surface: NativeChatRewindSurface
  /** `/rewind-conversation` and Esc three times: the latest message, after the same confirmation. */
  open: () => Promise<RewindOutcome>
}

const COMMAND = 'rewind-conversation'

function busyWords(chat: DroidRewindChat): string | null {
  const busy =
    chat.isWorking ||
    chat.sendOut ||
    chat.prompts.length > 0 ||
    chat.backgroundTasks.isMonitoring ||
    chat.queuedMessages.cards.length > 0
  return busy
    ? translate(
        'components.native-chat.droidRewind.busy',
        'Wait for Droid to finish before rewinding.'
      )
    : null
}

/** A sent message Droid has a record of, which it can go back to before. */
function rewindableMessages(
  chat: Pick<DroidRewindChat, 'messages' | 'submissions'>
): NativeChatMessage[] {
  return chat.messages.filter(
    (message) =>
      message.agentId === undefined &&
      nativeChatRowOffersRewind(message, { depth: 0, turnKey: message.id }, false) &&
      droidMessageIdOfJournalItem(message.id, chat.submissions) !== null
  )
}

function confirmationOptions(): Parameters<ConfirmationDialogContextValue>[0] {
  return {
    title: translate('components.native-chat.rewind.title', 'Rewind to here?'),
    description: translate(
      'components.native-chat.droidRewind.confirmation',
      'Go back to before this message? Droid opens a new session with the conversation up to here, puts back the files it changed since, and deletes the files it created. This session stays in Session History.'
    ),
    confirmLabel: translate('components.native-chat.rewind.confirm', 'Rewind'),
    cancelLabel: translate('components.native-chat.rewind.cancel', 'Cancel'),
    confirmVariant: 'destructive',
    cancelVariant: 'ghost'
  }
}

function rewoundWords(result: Extract<DroidHostCommandResult, { name: 'rewind' }>): string {
  return result.notRestoredCount > 0
    ? translate(
        'components.native-chat.droidRewind.rewoundWithFilesLeft',
        'Rewound the conversation. Files Droid could not put back: {{count}}. The earlier session stays in Session History.',
        { count: result.notRestoredCount }
      )
    : translate(
        'components.native-chat.droidRewind.rewound',
        'Rewound the conversation. The earlier session stays in Session History.'
      )
}

/**
 * Rewind of a Droid chat: Droid forks the conversation from before a message and the tab moves to
 * that session in place. Undefined for any other agent, which keeps its own rewind.
 */
export function useDroidRewind(args: {
  props: Pick<NativeChatStructuredViewProps, 'agent' | 'sessionId' | 'target' | 'tabId'>
  controller: DroidRewindChat
}): DroidRewind | undefined {
  const { props, controller } = args
  const dialog = useContext(ConfirmationDialogContext)
  const latest = useRef({ props, controller, dialog })
  useLayoutEffect(() => {
    latest.current = { props, controller, dialog }
  }, [props, controller, dialog])
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // Held from the click until the tab has moved: a second rewind of the same session would fork twice.
  const inFlight = useRef(false)

  const refusal = useCallback((): string | null => {
    if (inFlight.current) {
      return translate(
        'components.native-chat.droidRewind.inFlight',
        'Droid is already rewinding this conversation.'
      )
    }
    return busyWords(latest.current.controller)
  }, [])

  const rewindTo = useCallback(
    async (
      itemId: string,
      confirm: ConfirmationDialogContextValue,
      report: 'toast' | 'outcome'
    ): Promise<RewindOutcome> => {
      const refuse = (error: string): RewindOutcome => {
        if (report === 'toast') {
          toast.error(error)
        }
        return { accepted: false, error }
      }
      const refused = refusal()
      if (refused) {
        return refuse(refused)
      }
      const asked = latest.current.props
      inFlight.current = true
      let released = true
      try {
        const confirmed = await confirm(confirmationOptions())
        const now = latest.current
        if (!confirmed || !mounted.current || now.props.sessionId !== asked.sessionId) {
          return { accepted: false, error: null }
        }
        const busy = busyWords(now.controller)
        if (busy) {
          return refuse(busy)
        }
        let result: DroidHostCommandResult
        try {
          result = await callStructuredAgentSession<DroidHostCommandResult>(
            now.props.target,
            'agentSession.droidCommand',
            { sessionId: now.props.sessionId, command: { name: 'rewind', itemId } }
          )
        } catch (error) {
          return refuse(droidCommandFailureWords(error, COMMAND, true))
        }
        if (result.name !== 'rewind') {
          return refuse(droidCommandFailureWords(undefined, COMMAND, true))
        }
        const moved = switchDroidSessionWithNotice(
          {
            fromTabId: now.props.tabId,
            placement: 'replace',
            target: {
              kind: 'existing',
              droidSessionId: result.newSessionId,
              settings: droidSettingsKeptByClear(
                now.controller.optionSnapshot,
                now.controller.optionSurface
              )
            }
          },
          {
            opened: () => rewoundWords(result),
            failed: () =>
              translate(
                'components.native-chat.droidRewind.moveFailed',
                'Droid rewound the conversation into a new session, but Orca could not open it. The earlier session stays in Session History.'
              )
          }
        )
        released = false
        void moved.finally(() => {
          inFlight.current = false
        })
        return { accepted: true, error: null }
      } finally {
        if (released) {
          inFlight.current = false
        }
      }
    },
    [refusal]
  )

  const request = useCallback(
    async (itemId: string, confirm: ConfirmationDialogContextValue): Promise<void> => {
      await rewindTo(itemId, confirm, 'toast')
    },
    [rewindTo]
  )

  const open = useCallback(async (): Promise<RewindOutcome> => {
    const { dialog: confirm, controller: chat } = latest.current
    if (!confirm) {
      return {
        accepted: false,
        error: translate(
          'components.native-chat.droidChildCommands.rewindUnavailable',
          'This chat cannot rewind.'
        )
      }
    }
    const refused = refusal()
    if (refused) {
      return { accepted: false, error: refused }
    }
    const target = rewindableMessages(chat).at(-1)
    if (!target) {
      return {
        accepted: false,
        error: translate(
          'components.native-chat.droidRewind.nothingToRewind',
          'There is no message to rewind to.'
        )
      }
    }
    return rewindTo(target.id, confirm, 'outcome')
  }, [refusal, rewindTo])

  const { agent } = props
  const { messages, submissions } = controller
  const disabledReason = busyWords(controller)
  const eligibleItemIds = useMemo(
    () =>
      new Set(
        agent === 'droid' ? rewindableMessages({ messages, submissions }).map(({ id }) => id) : []
      ),
    [agent, messages, submissions]
  )
  const surface = useMemo(
    (): NativeChatRewindSurface => ({ disabledReason, eligibleItemIds, request }),
    [disabledReason, eligibleItemIds, request]
  )
  return useMemo(() => (agent === 'droid' ? { surface, open } : undefined), [agent, surface, open])
}
