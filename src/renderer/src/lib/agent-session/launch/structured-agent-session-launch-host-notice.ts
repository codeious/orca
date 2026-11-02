import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { selectExecutionHostDisplayLabel } from '@/lib/execution-host-display-label'
import { structuredAgentLabel } from '@/lib/agent-session/launch/structured-agent-session-launch-label'
import { structuredChatUnavailableText } from '@/lib/agent-session/launch/structured-agent-session-launch-failure'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { useAppStore } from '@/store/index'
import type { AgentCliInstallationProblem } from '../../../../../shared/agent-cli-installation-problem'
import { agentCliTooOldWords } from '../../../../../shared/agent-session/failures/agent-session-failure-copy'
import { sayAgentSessionFailureTranslated } from '@/components/native-chat/agent-session-failure-words-text'

export function notifyExplicitChatFailure(
  agent: TuiAgent,
  reason?: string,
  installation?: AgentCliInstallationProblem
): void {
  toast.error(
    translate(
      'auto.components.tab.bar.QuickLaunchButton.chatUnavailableAfterSelection',
      "Couldn't start a {{value0}} chat.",
      { value0: structuredAgentLabel(agent) }
    ),
    {
      description: installation
        ? agentCliTooOldWords(installation, sayAgentSessionFailureTranslated)
        : structuredChatUnavailableText(reason)
    }
  )
}

export function notifyHostDeclined(
  agent: TuiAgent,
  explain = true,
  installation?: AgentCliInstallationProblem
): void {
  const agentLabel = structuredAgentLabel(agent)
  toast.info(
    translate(
      'components.native-chat.structuredSessionHostDeclined',
      'Opened {{value0}} in a terminal',
      { value0: agentLabel }
    ),
    explain
      ? {
          description: installation
            ? agentCliTooOldWords(installation, sayAgentSessionFailureTranslated)
            : translate(
                'components.native-chat.structuredSessionHostDeclinedDescription',
                "This workspace can't run a {{value0}} chat.",
                { value0: agentLabel }
              )
        }
      : undefined
  )
}

export function notifyHostUnreachable(agent: TuiAgent, executionHostId: ExecutionHostId): void {
  const hostLabel = selectExecutionHostDisplayLabel(useAppStore.getState(), executionHostId)
  toast.error(
    translate(
      'components.native-chat.structuredSessionHostUnreachable',
      'Could not reach {{value0}}',
      {
        value0: hostLabel
      }
    ),
    {
      description: translate(
        'components.native-chat.structuredSessionHostUnreachableDescription',
        'Orca did not open a {{value0}} chat. Check the connection to the server and try again.',
        { value0: structuredAgentLabel(agent) }
      )
    }
  )
}
