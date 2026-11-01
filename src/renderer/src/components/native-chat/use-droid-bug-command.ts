import { useCallback, useContext, useLayoutEffect, useRef } from 'react'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { runtimeTargetEnvironmentId } from '@/runtime/runtime-client-target'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import type { AgentType } from '../../../../shared/agent-status-types'
import {
  DROID_BUG_COMMENT_MAX_LENGTH,
  type DroidHostCommandResult
} from '../../../../shared/droid-host-command'
import type { StructuredAgentSessionCommandOutcome } from '../../../../shared/structured-agent-session-composer'
import { droidCommandFailureWords } from './droid-child-command-words'

type Outcome = Omit<StructuredAgentSessionCommandOutcome, 'handled'>
type Chat = { agent: AgentType; sessionId: string; target: RuntimeClientTarget }

/** The comment stays in the pending call only, never in the dialog, notice or journal. */
export function useDroidBugCommand(chat: Chat): (comment: string) => Promise<Outcome> {
  const confirm = useContext(ConfirmationDialogContext)
  const current = useRef(chat)
  const mounted = useRef(false)
  const pending = useRef(false)
  useLayoutEffect(() => {
    current.current = chat
  }, [chat])
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  return useCallback(
    async (comment): Promise<Outcome> => {
      const cancelled = { accepted: false, error: null }
      if (chat.agent !== 'droid' || !confirm || pending.current) {
        return cancelled
      }
      if (comment.length > DROID_BUG_COMMENT_MAX_LENGTH) {
        return {
          accepted: false,
          error: translate(
            'components.native-chat.droidBug.tooLong',
            'Keep the /bug comment under {{max}} characters.',
            { max: String(DROID_BUG_COMMENT_MAX_LENGTH) }
          )
        }
      }
      pending.current = true
      try {
        const accepted = await confirm({
          title: translate(
            'components.native-chat.droidBug.title',
            'Send a bug report to Factory?'
          ),
          description: translate(
            'components.native-chat.droidBug.description',
            'Droid will send this comment and session diagnostics to Factory. The comment is not saved in this chat.'
          ),
          confirmLabel: translate('components.native-chat.droidBug.confirm', 'Send report'),
          cancelLabel: translate('components.native-chat.droidBug.cancel', 'Cancel'),
          cancelVariant: 'ghost'
        })
        const now = current.current
        if (
          !accepted ||
          !mounted.current ||
          now.agent !== chat.agent ||
          now.sessionId !== chat.sessionId ||
          runtimeTargetEnvironmentId(now.target) !== runtimeTargetEnvironmentId(chat.target)
        ) {
          return cancelled
        }
        const result = await callStructuredAgentSession<DroidHostCommandResult>(
          chat.target,
          'agentSession.droidCommand',
          {
            sessionId: chat.sessionId,
            command: { name: 'bug', ...(comment ? { userComment: comment } : {}) }
          }
        )
        return result.name === 'bug' && result.submitted
          ? {
              accepted: true,
              error: null,
              info: translate('components.native-chat.droidBug.sent', 'Bug report sent to Factory.')
            }
          : {
              accepted: false,
              error: translate(
                'components.native-chat.droidBug.failed',
                'Could not send the bug report. Try again.'
              )
            }
      } catch (error) {
        return { accepted: false, error: droidCommandFailureWords(error, 'bug', true) }
      } finally {
        pending.current = false
      }
    },
    [chat, confirm]
  )
}
