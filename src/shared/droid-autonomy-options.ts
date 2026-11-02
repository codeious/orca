/** Droid's autonomy level. It is Droid-only session draft state, not a catalog option: a catalog
 *  option is tracked per model and remembered for the next launch, and the level is neither. */
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

/** The next offered level above the current one, wrapping to the lowest. A current level Droid no
 *  longer offers still has a place in the order, so the key moves on instead of sticking. */
export function nextDroidAutonomyLevel(
  offered: readonly DroidAutonomyLevel[],
  current: DroidAutonomyLevel | undefined
): DroidAutonomyLevel | undefined {
  const ordered = DROID_AUTONOMY_LEVELS.filter((level) => offered.includes(level))
  if (current === undefined) {
    return ordered[0]
  }
  const rank = DROID_AUTONOMY_LEVELS.indexOf(current)
  return ordered.find((level) => DROID_AUTONOMY_LEVELS.indexOf(level) > rank) ?? ordered[0]
}
