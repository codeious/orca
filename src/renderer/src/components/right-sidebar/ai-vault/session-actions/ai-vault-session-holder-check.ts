import { toast } from 'sonner'
import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { revealTerminalPane } from '@/lib/workspace/activation/reveal-terminal-pane'
import { executionHostIdForStructuredTarget } from '@/runtime/native-chat/session-ownership/structured-agent-session-owner'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { structuredAgentSessionHostSupports } from '@/runtime/native-chat/host-capabilities/structured-agent-session-host-support'
import type { RuntimeClientTarget } from '../../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { AiVaultSession } from '../../../../../../shared/ai-vault/contracts/ai-vault-types'
import { AI_VAULT_SESSION_HOLDER_RUNTIME_CAPABILITY } from '../../../../../../shared/ai-vault/contracts/ai-vault-runtime-capabilities'
import { getNativeChatAgentProfile } from '../../../../../../shared/native-chat/native-chat-agent-profiles'
import {
  AI_VAULT_SESSION_HOLDER_CANNOT_TELL_RESULT,
  parseAiVaultSessionHolderResult,
  type AiVaultSessionHolderResult
} from '../../../../../../shared/ai-vault/contracts/ai-vault-session-holder'
import { resolveOriginalPaneTarget } from './ai-vault-original-pane'

type HeldSession = Pick<AiVaultSession, 'agent' | 'sessionId'>

async function readAiVaultSessionHolder(
  target: RuntimeClientTarget,
  session: HeldSession
): Promise<AiVaultSessionHolderResult> {
  try {
    if (
      await structuredAgentSessionHostSupports(target, AI_VAULT_SESSION_HOLDER_RUNTIME_CAPABILITY)
    ) {
      return parseAiVaultSessionHolderResult(
        await callRuntimeRpc(target, 'aiVault.sessionHolder', {
          agent: session.agent,
          sessionId: session.sessionId
        })
      )
    }
  } catch {
    // A disconnected host cannot prove its writer exited.
  }
  return AI_VAULT_SESSION_HOLDER_CANNOT_TELL_RESULT
}

function refuseLiveHolder(target: RuntimeClientTarget, result: AiVaultSessionHolderResult): void {
  const terminal = result.panes
    ?.filter((pane) => pane.verdict === 'live')
    .map((pane) =>
      resolveOriginalPaneTarget({ state: useAppStore.getState(), paneKey: pane.paneKey })
    )
    .find((pane) => pane !== null)
  toast.error(
    translate(
      'auto.components.right.sidebar.AiVaultPanel.resumeInChatHeld',
      'A terminal is still running this conversation. Open that terminal instead.'
    ),
    terminal
      ? {
          action: {
            label: translate('components.native-chat.sessionHolder.openTerminal', 'Open terminal'),
            onClick: () => {
              revealTerminalPane({
                ...terminal,
                executionHostId: executionHostIdForStructuredTarget(target)
              })
            }
          }
        }
      : undefined
  )
}

/** Two writers would split one history, so a live terminal refuses and an unprovable one asks first. */
export async function allowAiVaultChatResume(
  target: RuntimeClientTarget,
  session: HeldSession,
  confirm?: ConfirmationDialogContextValue
): Promise<boolean> {
  if (!getNativeChatAgentProfile(session.agent)?.confirmUnverifiableResume) {
    return true
  }
  const result = await readAiVaultSessionHolder(target, session)
  if (result.holder === null) {
    return true
  }
  if (result.holder === 'live') {
    refuseLiveHolder(target, result)
    return false
  }
  return confirm
    ? confirm({
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
    : false
}
