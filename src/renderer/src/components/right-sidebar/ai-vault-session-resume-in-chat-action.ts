import { useCallback } from 'react'
import { toast } from 'sonner'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import {
  decideAiVaultDroidChatResume,
  notifyAiVaultDroidSessionHeld
} from './ai-vault-droid-session-holder-check'
import { aiVaultSessionHasResumeInChatBranch } from './ai-vault-session-resume-in-chat'
import { resumeAiVaultSessionInNewChat } from './ai-vault-session-resume-in-chat-launch'

/** "Resume in New Native Chat" for a history row, shared by the Session History panel and the tab
 *  menu. A Droid row asks who holds it first; the other chat agents launch straight away. */
export function useAiVaultResumeInNewChatAction(
  fallbackWorktreeId: string | null
): (session: AiVaultSession, targetWorktreeId?: string) => void {
  const confirm = useConfirmationDialog()
  return useCallback(
    (session, targetWorktreeId) => {
      const { agent } = session
      if (!aiVaultSessionHasResumeInChatBranch(agent)) {
        return
      }
      const worktreeId = targetWorktreeId ?? fallbackWorktreeId
      if (!worktreeId) {
        toast.error(
          translate(
            'auto.components.right.sidebar.AiVaultPanel.openWorkspaceBeforeResuming',
            'Open a workspace before resuming a session.'
          )
        )
        return
      }
      const requestId = newAgentLaunchRequestId()
      void (async () => {
        if (agent === 'droid') {
          const decision = await decideAiVaultDroidChatResume({ session, confirm })
          if (decision === 'held') {
            notifyAiVaultDroidSessionHeld()
          }
          if (decision !== 'resume') {
            return
          }
        }
        await resumeAiVaultSessionInNewChat(session, agent, worktreeId, requestId)
      })()
    },
    [confirm, fallbackWorktreeId]
  )
}
