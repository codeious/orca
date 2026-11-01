// The thread-goal part of the agent-session wire: a client's change to the goal and the host's answer.

/** Longest objective a client may send; matches the provider's own limit. */
export const AGENT_SESSION_THREAD_GOAL_OBJECTIVE_MAX_LENGTH = 4000

/** A client's change to the thread goal. `set` replaces the objective and makes
 *  it active, which the provider pursues without a separate turn. */
export type AgentSessionThreadGoalChange =
  | { kind: 'set'; objective: string }
  | { kind: 'status'; status: 'active' | 'paused' }
  | { kind: 'clear' }

export type AgentSessionThreadGoalResult = {
  change: AgentSessionThreadGoalChange['kind']
}
