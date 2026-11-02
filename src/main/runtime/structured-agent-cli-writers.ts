import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import type { StructuredAgentId } from '../../shared/agent-session/lifecycle/agent-session-provider-handle'
import { namesCliConversation } from '../../shared/structured-agent-cli-conversation-adoption'
import { agentSessionRefusalError } from '../../shared/agent-session/failures/agent-session-wire-refusals'
import type { CliWriterObservation } from '../agent-hooks/server/cli-writer-observation'
import type {
  AiVaultSessionHolderResult,
  AiVaultHoldingPane
} from '../../shared/ai-vault-session-holder'

export type CliWriterHost = {
  rows: () => AgentStatusIpcPayload[]
  observation: (row: AgentStatusIpcPayload) => CliWriterObservation | null
}

export async function readCliConversationHolders(
  host: CliWriterHost,
  agent: StructuredAgentId,
  providerSessionId: string
): Promise<AiVaultSessionHolderResult> {
  const panes: AiVaultHoldingPane[] = []
  for (const row of host.rows()) {
    if (row.structuredHost || !namesCliConversation(row, agent, providerSessionId)) {
      continue
    }
    const observation = host.observation(row)
    const verdict = await observation?.presence().catch(() => null)
    if (observation?.current() && verdict === 'exited') {
      continue
    }
    panes.push({
      paneKey: row.paneKey,
      verdict: observation?.current() && verdict === 'live' ? 'live' : 'unverifiable'
    })
  }
  return {
    holder: panes.some((pane) => pane.verdict === 'live')
      ? 'live'
      : panes.length > 0
        ? 'unverifiable'
        : null,
    panes
  }
}

/** Only a live holder in the execution host's status store blocks continuation. */
export async function assertCliConversationWritersExited(
  host: CliWriterHost,
  agent: StructuredAgentId,
  providerSessionId: string
): Promise<void> {
  for (const row of host.rows()) {
    if (row.structuredHost || !namesCliConversation(row, agent, providerSessionId)) {
      continue
    }
    const observation = host.observation(row)
    // Only a process proven running refuses; no recorded process, exited and unverifiable admit.
    if ((await observation?.presence()) === 'live' && observation?.current()) {
      throw agentSessionRefusalError('agent_session_conflict', {
        reason: 'conversationHeldElsewhere'
      })
    }
  }
}
