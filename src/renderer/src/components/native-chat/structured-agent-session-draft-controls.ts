import { useMemo } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { DROID_AUTONOMY_OPTION_ID } from '../../../../shared/droid-autonomy-options'
import {
  canSetDroidAutonomyOption,
  droidAutonomySurface
} from '../../../../shared/droid-autonomy-view'
import { isDroidSpecPairOptionId } from '../../../../shared/droid-spec-pair-options'
import {
  canSetDroidSpecPairOption,
  droidSpecPairSurfaceOf
} from '../../../../shared/droid-spec-pair-view'
import {
  canSetStructuredAgentSessionOption,
  type StructuredAgentSessionOptionState
} from '../../../../shared/structured-agent-session-options'
import type { SessionOptionValue } from '../../../../shared/native-chat-session-options'
import { structuredAgentSessionOptionView } from '../../../../shared/structured-agent-session-option-view'

type Seed = Readonly<Record<string, string>> | undefined

/**
 * Droid's Spec pair and autonomy level: session draft state drawn beside the pills, never one of a
 * model's options. Each is null for an agent without it or before the host has answered.
 */
export function useStructuredAgentSessionDraftControls(args: {
  agent: AgentType
  state: StructuredAgentSessionOptionState
  seed: Seed
  held: Readonly<Record<string, string>>
  acceptsPicks: boolean
}) {
  const { agent, state, seed, held, acceptsPicks } = args
  const specPair = useMemo(
    () => droidSpecPairSurfaceOf(state, seed, held, acceptsPicks),
    [acceptsPicks, held, seed, state]
  )
  const autonomy = useMemo(
    () => (agent === 'droid' ? droidAutonomySurface(state, held, acceptsPicks, seed) : null),
    [acceptsPicks, agent, held, seed, state]
  )
  return { specPair, autonomy }
}

/** Whether a pick is on offer: Spec's pair and the level by their own rules, the rest by the catalog. */
export function canSetStructuredSessionPick(args: {
  agent: AgentType
  state: StructuredAgentSessionOptionState
  seed: Seed
  held: Readonly<Record<string, string>>
  id: string
  value: SessionOptionValue
  encoded: string | null
}): boolean {
  const { agent, state, seed, held, id, value, encoded } = args
  if (id === DROID_AUTONOMY_OPTION_ID) {
    return agent === 'droid' && canSetDroidAutonomyOption(state, held, encoded ?? '', seed)
  }
  const view = structuredAgentSessionOptionView(state, seed, held)
  return isDroidSpecPairOptionId(id)
    ? canSetDroidSpecPairOption(view, id, encoded ?? '', seed, held)
    : canSetStructuredAgentSessionOption(view, id, value)
}
