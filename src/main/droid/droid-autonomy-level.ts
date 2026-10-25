export const DROID_AUTONOMY_LEVELS = ['off', 'low', 'medium', 'high'] as const
export type DroidAutonomyLevel = (typeof DROID_AUTONOMY_LEVELS)[number]

export function isDroidAutonomyLevel(value: unknown): value is DroidAutonomyLevel {
  return DROID_AUTONOMY_LEVELS.some((level) => level === value)
}

/**
 * The level the Agent Permissions arguments ask for, read the way `droid --auto` would:
 * the last `--auto <level>` wins, `--skip-permissions-unsafe` is `high`, and nothing is `off`.
 * A level Droid does not know reads as `off` so a typo never widens what runs unattended.
 */
export function droidAutonomyLevelFromLaunchArgs(args: readonly string[]): DroidAutonomyLevel {
  let named: DroidAutonomyLevel | null = null
  let sawAuto = false
  let skipsPermissions = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--skip-permissions-unsafe') {
      skipsPermissions = true
    } else if (arg === '--auto' || arg.startsWith('--auto=')) {
      sawAuto = true
      const value = arg === '--auto' ? args[index + 1] : arg.slice('--auto='.length)
      named = isDroidAutonomyLevel(value) ? value : 'off'
    }
  }
  if (sawAuto) {
    return named ?? 'off'
  }
  return skipsPermissions ? 'high' : 'off'
}

/** Droid clamps an org-capped level silently, so a lower reported level is the only signal. */
export function droidAutonomyLowerThanAsked(
  reported: DroidAutonomyLevel,
  asked: DroidAutonomyLevel
): boolean {
  return DROID_AUTONOMY_LEVELS.indexOf(reported) < DROID_AUTONOMY_LEVELS.indexOf(asked)
}
