import {
  structuredPlanModePair,
  structuredPlanModeShownPair
} from './structured-agent-session-plan-mode-pair'
import type { StructuredAgentSessionOptionRecord } from './structured-agent-session-option-state'
import type { StructuredAgentSessionOptionState } from './structured-agent-session-options'

/** Plan mode runs its own pair, so the model controls show that pair while it is on. */
export function planModeDisplayRecord(
  state: StructuredAgentSessionOptionState,
  mainModel: string | null | undefined,
  mainIsCliDefault: boolean
): StructuredAgentSessionOptionRecord {
  const { record, catalog } = state
  const pair = structuredPlanModePair(record.agent)
  if (
    !pair ||
    (state.optionsAnswerPresent && record.values.model !== undefined) ||
    record.values.planMode?.value !== true ||
    !catalog
  ) {
    return record
  }
  const effort = catalog.models
    .find((row) => row.id === mainModel)
    ?.options.find((row) => row.id === 'effort')?.kind
  const string = (id: string): string | undefined => {
    const value = record.values[id]?.value
    return typeof value === 'string' ? value : undefined
  }
  const shown = structuredPlanModeShownPair(
    pair,
    {
      model: mainModel ?? undefined,
      effort:
        string('effort') ??
        (mainIsCliDefault && effort?.type === 'select' && effort.defaultIsCliDefault
          ? effort.defaultValue
          : undefined)
    },
    {
      [pair.modelOptionId]: string(pair.modelOptionId),
      [pair.effortOptionId]: string(pair.effortOptionId)
    },
    state.configuredSpec
  )
  const values = { ...record.values }
  for (const key of ['model', 'effort'] as const) {
    const own = record.values[key === 'model' ? pair.modelOptionId : pair.effortOptionId]
    const value = shown[key]
    if (value) {
      values[key] = {
        value,
        source:
          own && own.value !== pair.sameAsMain
            ? own.source
            : state.configuredSpec?.[key]
              ? 'default'
              : (record.values[key]?.source ?? 'default')
      }
    }
  }
  return { ...record, values }
}
