/** Spec's model and effort belong to the session, not to per-model launch defaults. */
export const DROID_SPEC_MODEL_OPTION_ID = 'specModel'
export const DROID_SPEC_EFFORT_OPTION_ID = 'specEffort'

/** The choice that clears a Spec value: no model id can be this, and a pick is a non-empty string. */
export const DROID_SPEC_SAME_AS_MAIN = 'same-as-main'

export function droidSpecDisplayPair(
  main: { model?: string; effort?: string },
  saved: Readonly<Record<string, string | undefined>>,
  configured?: { model: string; effort?: string }
): { model?: string; effort?: string } {
  const own = (value: string | undefined): string | undefined =>
    value && value !== DROID_SPEC_SAME_AS_MAIN ? value : undefined
  return {
    model: own(saved[DROID_SPEC_MODEL_OPTION_ID]) ?? configured?.model ?? main.model,
    effort: own(saved[DROID_SPEC_EFFORT_OPTION_ID]) ?? configured?.effort ?? main.effort
  }
}
