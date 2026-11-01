// What the autonomy control of a Droid chat shows and accepts. The level is not a catalog option, so
// none of this goes through the record that tracks a model's options.

import {
  DROID_AUTONOMY_LEVELS,
  DROID_AUTONOMY_OPTION_ID,
  droidAutonomyLevelFromSavedOptions,
  isDroidAutonomyLevel,
  type DroidAutonomyLevel
} from './droid-autonomy-options'
import { isDroidSpecPairOptionId } from './droid-spec-pair-options'
import type { SessionOptionAutonomy } from './native-chat-session-options'
import type { StructuredAgentSessionOptionState } from './structured-agent-session-options'

/** Droid's own session draft state: the autonomy level and the Spec pair. Neither is a pick under a
 *  model, so neither is remembered for the next launch. */
export function isDroidDraftOptionId(id: string): boolean {
  return id === DROID_AUTONOMY_OPTION_ID || isDroidSpecPairOptionId(id)
}

/** The control's contents, or null until an answer names a level. */
export function droidAutonomySurface(
  state: StructuredAgentSessionOptionState,
  held: Readonly<Record<string, string>>,
  settable: boolean,
  seed?: Readonly<Record<string, string>>
): SessionOptionAutonomy | null {
  if (!state.autonomy) {
    return null
  }
  const heldLevel = held[DROID_AUTONOMY_OPTION_ID]
  // A launch's seed lives as long as its chat view, so it must yield once a child reports: that
  // answer is Droid's value, which may be lower than the one asked for.
  const seededLevel =
    state.autonomy.available === undefined ? droidAutonomyLevelFromSavedOptions(seed) : undefined
  const level: DroidAutonomyLevel = isDroidAutonomyLevel(heldLevel)
    ? heldLevel
    : (seededLevel ?? state.autonomy.level)
  return { level, levels: state.autonomy.available ?? DROID_AUTONOMY_LEVELS, settable }
}

/** A pick the control offers: one of the levels it lists, while no other option is in flight. */
export function canSetDroidAutonomyOption(
  state: StructuredAgentSessionOptionState,
  held: Readonly<Record<string, string>>,
  value: string,
  seed?: Readonly<Record<string, string>>
): boolean {
  const surface = droidAutonomySurface(state, held, true, seed)
  return (
    surface !== null &&
    state.pendingId === null &&
    isDroidAutonomyLevel(value) &&
    surface.levels.includes(value)
  )
}

/** The state once the host has accepted a pick of the level; no model option is touched. */
export function withDroidAutonomyPick(
  state: StructuredAgentSessionOptionState,
  level: string
): StructuredAgentSessionOptionState {
  if (!isDroidAutonomyLevel(level)) {
    return state
  }
  return {
    ...state,
    autonomy: {
      level,
      ...(state.autonomy?.available ? { available: state.autonomy.available } : {})
    },
    pendingId: null
  }
}
