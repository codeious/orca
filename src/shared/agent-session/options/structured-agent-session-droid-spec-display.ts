import { droidSpecDisplayPair, DROID_SPEC_SAME_AS_MAIN } from '../../droid-spec-pair-options'
import type { StructuredAgentSessionOptionRecord } from './structured-agent-session-option-state'
import type { StructuredAgentSessionOptionState } from './structured-agent-session-options'

export function droidSpecDisplayRecord(
  state: StructuredAgentSessionOptionState,
  mainModel: string | null | undefined,
  mainIsCliDefault: boolean
): StructuredAgentSessionOptionRecord {
  const { record, catalog } = state
  if (
    record.agent !== 'droid' ||
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
  const pair = droidSpecDisplayPair(
    {
      model: mainModel ?? undefined,
      effort:
        string('effort') ??
        (mainIsCliDefault && effort?.type === 'select' && effort.defaultIsCliDefault
          ? effort.defaultValue
          : undefined)
    },
    { specModel: string('specModel'), specEffort: string('specEffort') },
    state.configuredSpec
  )
  const values = { ...record.values }
  for (const key of ['model', 'effort'] as const) {
    const own = record.values[key === 'model' ? 'specModel' : 'specEffort']
    const value = pair[key]
    if (value) {
      values[key] = {
        value,
        source:
          own && own.value !== DROID_SPEC_SAME_AS_MAIN
            ? own.source
            : state.configuredSpec?.[key]
              ? 'default'
              : (record.values[key]?.source ?? 'default')
      }
    }
  }
  return { ...record, values }
}
