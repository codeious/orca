import { toast } from 'sonner'
import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { revealTerminalPane } from '@/lib/reveal-terminal-pane'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { structuredAgentSessionHostSupports } from '@/runtime/structured-agent-session-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { getNativeChatAgentProfile } from '../../../../shared/native-chat/native-chat-agent-profiles'
import {
  AI_VAULT_SESSION_HOLDER_CAPABILITY,
  AI_VAULT_SESSION_HOLDER_CANNOT_TELL_RESULT,
  parseAiVaultSessionHolderResult
} from '../../../../shared/ai-vault-session-holder'
import { resolveOriginalPaneTarget } from './ai-vault-original-pane'

export async function readAiVaultSessionHolder(
  target: RuntimeClientTarget,
  session: Pick<AiVaultSession, 'agent' | 'sessionId'>
) {
  try {
    if (await structuredAgentSessionHostSupports(target, AI_VAULT_SESSION_HOLDER_CAPABILITY)) {
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

export async function allowAiVaultChatResume(
  target: RuntimeClientTarget,
  session: Pick<AiVaultSession, 'agent' | 'sessionId'>,
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
              label: translate(
                'components.native-chat.sessionHolder.openTerminal',
                'Open terminal'
              ),
              onClick: () => {
                revealTerminalPane({
                  ...terminal,
                  executionHostId:
                    target.kind === 'environment' ? `runtime:${target.environmentId}` : 'local'
                })
              }
            }
          }
        : undefined
    )
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
