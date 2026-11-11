import { DROID_PLAN_MODE_PAIR } from '../../droid-spec-pair-options'
import type { AgentType } from '../../agent-status/contracts/agent-status-types'

/** The options an agent saves its plan-mode model and effort under, apart from its main pair. */
export type StructuredPlanModePair = {
  modelOptionId: string
  effortOptionId: string
  /** The saved value that follows the main pair; no model id or effort can be it. */
  sameAsMain: string
}

const PLAN_MODE_PAIRS: Partial<Record<AgentType, StructuredPlanModePair>> = {
  droid: DROID_PLAN_MODE_PAIR
}

export function structuredPlanModePair(
  agent: AgentType | null | undefined
): StructuredPlanModePair | null {
  return agent ? (PLAN_MODE_PAIRS[agent] ?? null) : null
}

/** Every registered pair's ids, for seeds and picks that are not keyed by agent. */
export const STRUCTURED_PLAN_MODE_PAIR_OPTION_IDS: readonly string[] = [
  ...new Set(
    Object.values(PLAN_MODE_PAIRS).flatMap((pair) =>
      pair ? [pair.modelOptionId, pair.effortOptionId] : []
    )
  )
]

/** The pair plan mode runs: the saved pick, else the agent's configured one, else the main pair. */
export function structuredPlanModeShownPair(
  pair: StructuredPlanModePair,
  main: { model?: string; effort?: string },
  saved: Readonly<Record<string, string | undefined>>,
  configured?: { model: string; effort?: string }
): { model?: string; effort?: string } {
  const own = (value: string | undefined): string | undefined =>
    value && value !== pair.sameAsMain ? value : undefined
  return {
    model: own(saved[pair.modelOptionId]) ?? configured?.model ?? main.model,
    effort: own(saved[pair.effortOptionId]) ?? configured?.effort ?? main.effort
  }
}

/** In plan mode the saved main pair is not what runs; at rest the reported pair stands in for it. */
export function structuredPlanModeSavedOptions(
  agent: AgentType | null | undefined,
  saved: Record<string, string>,
  current: {
    planMode?: boolean
    model?: string
    effort?: string
    defaulted?: readonly ('model' | 'effort')[]
  },
  live: boolean
): Record<string, string> {
  if (!structuredPlanModePair(agent) || current.planMode !== true) {
    return saved
  }
  const { model: _model, effort: _effort, ...rest } = saved
  if (live) {
    return rest
  }
  for (const key of ['model', 'effort'] as const) {
    const value = current[key]
    if (value !== undefined && !current.defaulted?.includes(key)) {
      rest[key] = value
    }
  }
  return rest
}
