import {
  readAgentSessionHostText,
  type AgentSessionHostText
} from '../../../shared/agent-session-host-text'

/** Option validation failed before the provider session was mutated. */
export class AgentSessionOptionRejectedError extends Error implements AgentSessionHostText {
  declare readonly textKey?: string
  declare readonly textParams?: Record<string, string | number>

  constructor(
    cause: unknown,
    /** `providerStarting`: nothing is wrong with the value; the session cannot take it yet.
     *  `providerRefusedOption`: the provider said why in this error's message, which a client may show. */
    readonly refusalReason:
      | 'optionRejected'
      | 'providerStarting'
      | 'providerRefusedOption' = 'optionRejected'
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'AgentSessionOptionRejectedError'
    Object.assign(this, readAgentSessionHostText(cause))
  }
}

export function isAgentSessionOptionRejectedError(
  error: unknown
): error is AgentSessionOptionRejectedError {
  return error instanceof Error && error.name === 'AgentSessionOptionRejectedError'
}
