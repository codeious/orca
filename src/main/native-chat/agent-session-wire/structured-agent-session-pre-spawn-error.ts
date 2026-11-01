import type { UnsupportedVersionFacts } from '../../../shared/agent-session-refusal-details'
import type { AgentSessionRefusalReason } from '../../../shared/agent-session-wire-refusals'

/** A refusal before spawn that a person can act on; the site that refused names it. */
export type AgentSessionPreSpawnReason = Extract<
  AgentSessionRefusalReason<'agent_session_operation_invalid'>,
  | 'managedAccountEnvOverride'
  | 'accountSwitchInProgress'
  | 'managedAccountUnsupported'
  | 'launchFolderMissing'
  | 'historyInOtherAccount'
  | 'claudeAccountFolderMissing'
  | 'claudeAccountSetupFailed'
  | 'agentCommandNotRunnable'
>

/** Acquisition failed with first-hand proof that no provider process existed. */
export class AgentSessionPreSpawnError extends Error {
  /** Absent: Orca's own reason, which only the log reads. A wrapped pre-spawn error keeps its. */
  readonly reason: AgentSessionPreSpawnReason | undefined
  /** Present when the start was refused over the agent's release: that refusal is not an
   *  `agent_session_operation_invalid` one, so it travels here to keep its code. A wrap keeps it.
   *  Empty: the release is fine and its protocol is what the chat doesn't speak. */
  readonly releaseFacts: UnsupportedVersionFacts | undefined

  constructor(
    cause: unknown,
    options: {
      reason?: AgentSessionPreSpawnReason
      message?: string
      releaseFacts?: UnsupportedVersionFacts
    } = {}
  ) {
    super(options.message ?? (cause instanceof Error ? cause.message : String(cause)), { cause })
    this.name = 'AgentSessionPreSpawnError'
    this.reason = options.reason ?? (isAgentSessionPreSpawnError(cause) ? cause.reason : undefined)
    this.releaseFacts =
      options.releaseFacts ?? (isAgentSessionPreSpawnError(cause) ? cause.releaseFacts : undefined)
  }

  /** Refused before spawn because the installed release is one the chat can't run. */
  static unsupportedRelease(facts: UnsupportedVersionFacts = {}): AgentSessionPreSpawnError {
    return new AgentSessionPreSpawnError(new Error('the agent release is not supported'), {
      releaseFacts: facts
    })
  }
}

export function isAgentSessionPreSpawnError(error: unknown): error is AgentSessionPreSpawnError {
  return error instanceof Error && error.name === 'AgentSessionPreSpawnError'
}
