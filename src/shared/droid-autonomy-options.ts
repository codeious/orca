/** Session-only autonomy, never remembered as a per-model launch default. */
export const DROID_AUTONOMY_OPTION_ID = 'autonomyLevel'

export const DROID_AUTONOMY_LEVELS = ['off', 'low', 'medium', 'high'] as const
export type DroidAutonomyLevel = (typeof DROID_AUTONOMY_LEVELS)[number]

export function isDroidAutonomyLevel(value: unknown): value is DroidAutonomyLevel {
  return DROID_AUTONOMY_LEVELS.some((level) => level === value)
}

/** The level Droid holds and the levels it offers; offered is absent until a child reports it. */
export function droidAutonomyLevelFromSavedOptions(
  options: Readonly<Record<string, string>> | undefined
): DroidAutonomyLevel | undefined {
  const saved = options?.[DROID_AUTONOMY_OPTION_ID]
  return isDroidAutonomyLevel(saved) ? saved : undefined
}
