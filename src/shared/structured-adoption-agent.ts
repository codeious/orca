import { isAgentSessionHandleProvider } from './agent-session-provider-handle'

/** Claude and Codex adopt from their transcripts; Droid from its session file. */
export type StructuredAdoptionAgent = 'claude' | 'codex' | 'droid'

/** The agents Resume in new chat can adopt. Droid is not a provider-handle agent, so it is listed
 *  here rather than by widening `isAgentSessionHandleProvider`. */
export function isStructuredAdoptionAgent(agent: unknown): agent is StructuredAdoptionAgent {
  return isAgentSessionHandleProvider(agent) || agent === 'droid'
}
