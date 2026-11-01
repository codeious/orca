import { DROID_AUTONOMY_OPTION_ID } from './droid-autonomy-options'
import { DROID_SPEC_EFFORT_OPTION_ID, DROID_SPEC_MODEL_OPTION_ID } from './droid-spec-pair-options'
import type { SessionOptionDescriptor, SessionOptionsSurface } from './native-chat-session-options'
import { encodeStructuredAgentSessionOptionValue } from './structured-agent-session-option-codec'

/** What a new Droid session starts with. A missing field is left to the new-chat defaults. */
export type DroidFreshSessionSettings = {
  model?: string
  effort?: string
  autonomyLevel?: string
  /** Droid's Spec interaction mode; `false` starts in Auto even if the saved defaults say Spec. */
  spec?: boolean
  /** A model id, or `DROID_SPEC_SAME_AS_MAIN` to run Spec on the main model. */
  specModel?: string
  specEffort?: string
}

/** Model goes first: holding it drops the picks held under the model it replaces. */
export function droidFreshSessionOptionPicks(
  settings: DroidFreshSessionSettings
): [string, string][] {
  const picks: [string, string | undefined][] = [
    ['model', settings.model],
    ['effort', settings.effort],
    [
      'planMode',
      settings.spec === undefined
        ? undefined
        : (encodeStructuredAgentSessionOptionValue('planMode', settings.spec) ?? undefined)
    ],
    [DROID_SPEC_MODEL_OPTION_ID, settings.specModel],
    [DROID_SPEC_EFFORT_OPTION_ID, settings.specEffort],
    [DROID_AUTONOMY_OPTION_ID, settings.autonomyLevel]
  ]
  return picks.flatMap(([id, encoded]) => (encoded === undefined ? [] : [[id, encoded]]))
}

/** `/new`: Auto, and the rest as a newly opened Droid chat has it. */
export const DROID_NEW_SESSION_SETTINGS: DroidFreshSessionSettings = { spec: false }

/** A value the catalog shows before the agent said anything is no evidence of what runs. */
function reportedDescriptor(
  snapshot: readonly SessionOptionDescriptor[],
  id: string
): SessionOptionDescriptor | undefined {
  const descriptor = snapshot.find((entry) => entry.id === id)
  return descriptor && descriptor.valueSource !== 'default' && descriptor.valueSource !== 'unknown'
    ? descriptor
    : undefined
}

function selectedValue(snapshot: readonly SessionOptionDescriptor[], id: string) {
  const kind = reportedDescriptor(snapshot, id)?.kind
  return kind?.type === 'select' && kind.currentValue ? kind.currentValue : undefined
}

/**
 * `/clear`: what the tab runs on now, so the fresh session keeps it. A Spec pair that runs on the
 * main model is left out rather than named, since the session then starts on the main model too.
 */
export function droidSettingsKeptByClear(
  snapshot: readonly SessionOptionDescriptor[],
  surface: Pick<SessionOptionsSurface, 'specPair' | 'autonomy'> | undefined
): DroidFreshSessionSettings {
  const model = selectedValue(snapshot, 'model')
  const effort = selectedValue(snapshot, 'effort')
  const specKind = reportedDescriptor(snapshot, 'planMode')?.kind
  const pair = surface?.specPair
  return {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(specKind?.type === 'boolean' ? { spec: specKind.currentValue } : {}),
    ...(surface?.autonomy ? { autonomyLevel: surface.autonomy.level } : {}),
    ...(pair?.model ? { specModel: pair.model } : {}),
    ...(pair?.effort ? { specEffort: pair.effort } : {})
  }
}
