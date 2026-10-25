import { toast } from 'sonner'
import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import {
  AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL,
  type AiVaultDroidSessionHolder
} from '../../../../shared/ai-vault-droid-session-holder'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'

export type AiVaultDroidChatResumeDecision = 'resume' | 'held' | 'declined'

/** Only a literal `null` frees the session. A stale bridge, a thrown call, or an unknown word is
 *  cannot-tell, never free. */
export async function askAiVaultDroidSessionHolder(
  session: Pick<AiVaultSession, 'executionHostId' | 'sessionId'>
): Promise<AiVaultDroidSessionHolder> {
  try {
    const holder: unknown = await window.api.aiVault.droidSessionHolder({
      executionHostId: session.executionHostId,
      sessionId: session.sessionId
    })
    if (holder === null) {
      return null
    }
    return holder === 'live' ? 'live' : AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL
  } catch {
    return AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL
  }
}

/** The row's verdict may be minutes old, so the click asks again before a second writer can start. */
export async function decideAiVaultDroidChatResume(args: {
  session: Pick<AiVaultSession, 'executionHostId' | 'sessionId'>
  confirm: ConfirmationDialogContextValue
}): Promise<AiVaultDroidChatResumeDecision> {
  const holder = await askAiVaultDroidSessionHolder(args.session)
  if (holder === null) {
    return 'resume'
  }
  if (holder === 'live') {
    return 'held'
  }
  const confirmed = await args.confirm({
    title: translate(
      'auto.components.right.sidebar.AiVaultResumeInChatHeldDialog.title',
      'Resume in a new chat?'
    ),
    description: translate(
      'auto.components.right.sidebar.AiVaultResumeInChatHeldDialog.description',
      'Orca cannot tell whether a terminal is still running this conversation. If one is, both will write to the same history and split it in two.'
    ),
    confirmLabel: translate(
      'auto.components.right.sidebar.AiVaultResumeInChatHeldDialog.confirm',
      'Resume anyway'
    )
  })
  return confirmed ? 'resume' : 'declined'
}

export function notifyAiVaultDroidSessionHeld(): void {
  toast.error(
    translate(
      'auto.components.right.sidebar.AiVaultPanel.resumeInChatHeld',
      'A terminal is still running this conversation. Open that terminal instead.'
    )
  )
}
