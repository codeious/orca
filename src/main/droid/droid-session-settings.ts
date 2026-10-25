import { decodeStructuredAgentSessionOptionValue } from '../../shared/structured-agent-session-option-codec'
import type { DroidAutonomyLevel } from './droid-autonomy-level'

/** Never `mission`: those spend the person's credits unattended. */
export type DroidInteractionMode = 'auto' | 'spec'

/** What a start or resume pins on the session; the level and mode it stored are never inherited. */
export type DroidStartSettings = {
  autonomyLevel: DroidAutonomyLevel
  interactionMode: DroidInteractionMode
}

/** Spec is the saved `planMode` pick; anything that is not a stored `true` starts in auto. */
export function droidInteractionModeFromSavedOptions(
  options: Readonly<Record<string, string>> | undefined
): DroidInteractionMode {
  const saved = options?.planMode
  return saved !== undefined && decodeStructuredAgentSessionOptionValue('planMode', saved) === true
    ? 'spec'
    : 'auto'
}
