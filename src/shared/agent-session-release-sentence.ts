import type { AgentSessionFailureFact } from './agent-session-failure'
import type { AgentSessionFailureSay } from './agent-session-failure-copy'
import type { AgentSessionFailureWordsContext } from './agent-session-failure-words'

/** A release too old names itself and the update that fixes it; one the chat can't speak to is no
 *  update's doing. Undefined when the refusal is not over the agent's release. */
export function unsupportedReleaseSentence(
  { agentName }: AgentSessionFailureWordsContext,
  refusal: AgentSessionFailureFact['refusal'],
  say: AgentSessionFailureSay
): string | undefined {
  if (
    refusal?.code !== 'structured_agent_session_unsupported' ||
    refusal.details?.reason !== 'versionUnsupported'
  ) {
    return undefined
  }
  const { version, floor, updateCommand } = refusal.details
  const values = { agent: agentName ?? say('theAgent') }
  return version && floor && updateCommand
    ? say('agentVersionBelowFloor', { ...values, found: version, floor, updateCommand })
    : say('agentProtocolUnsupported', values)
}
