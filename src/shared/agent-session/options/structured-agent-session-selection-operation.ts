import type { AgentSessionWriteFailure } from '../failures/agent-session-write-failure'

export type SelectionOutcome =
  | { kind: 'accepted'; options: Readonly<Record<string, string>> }
  | { kind: 'refused'; failure?: AgentSessionWriteFailure }
  | { kind: 'superseded' }
  | { kind: 'unknown'; failure?: AgentSessionWriteFailure }

export type SelectionOperation = {
  identity: number
  key: string
  value: string
  model: string | null
  /** False when remembering must leave the new-chat model alone. */
  adoptsModel?: false
  transmitted: boolean
  outcome?: SelectionOutcome
  request?: Promise<SelectionOutcome>
  result: Promise<SelectionOutcome>
  resolve: (outcome: SelectionOutcome) => void
  previousPending?: SelectionOperation
  nextPending?: SelectionOperation
}
