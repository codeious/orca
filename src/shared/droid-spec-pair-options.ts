/** Droid's Spec mode may run its own model and effort. They are Droid-only session draft state, not
 *  catalog options: a catalog option is tracked per model and remembered for the next launch. */
export const DROID_SPEC_MODEL_OPTION_ID = 'specModel'
export const DROID_SPEC_EFFORT_OPTION_ID = 'specEffort'

export const DROID_SPEC_PAIR_OPTION_IDS = [
  DROID_SPEC_MODEL_OPTION_ID,
  DROID_SPEC_EFFORT_OPTION_ID
] as const

/** The choice that clears a Spec value: no model id can be this, and a pick is a non-empty string. */
export const DROID_SPEC_SAME_AS_MAIN = 'same-as-main'

export function isDroidSpecPairOptionId(id: string): boolean {
  return id === DROID_SPEC_MODEL_OPTION_ID || id === DROID_SPEC_EFFORT_OPTION_ID
}

/** Spec's switch and its pair are the session's, so a main model pick does not replace them. */
export function isDroidSessionSpecOptionId(id: string): boolean {
  return id === 'planMode' || isDroidSpecPairOptionId(id)
}

/** The model and effort Spec runs on; an absent one is the main model's or effort. */
export type DroidSpecPair = { model?: string; effort?: string }

export function droidSpecPairOf(
  values: Readonly<Record<string, string | undefined>> | undefined
): DroidSpecPair {
  const model = values?.[DROID_SPEC_MODEL_OPTION_ID]
  const effort = values?.[DROID_SPEC_EFFORT_OPTION_ID]
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
}

/** The pair once one pick lands, by the same rule the saved options follow. */
export function droidSpecPairAfterPick(
  pair: DroidSpecPair,
  key: string,
  value: string
): DroidSpecPair {
  return droidSpecPairOf(
    droidSpecPairSavedOptionsAfterPick(
      {
        ...(pair.model ? { [DROID_SPEC_MODEL_OPTION_ID]: pair.model } : {}),
        ...(pair.effort ? { [DROID_SPEC_EFFORT_OPTION_ID]: pair.effort } : {})
      },
      key,
      value
    )
  )
}

/** The saved options once a pick lands. Clearing removes the Spec value instead of saving the choice
 *  as an id, and clearing the model clears the effort that belonged to it. */
export function droidSpecPairSavedOptionsAfterPick(
  options: Readonly<Record<string, string>>,
  key: string,
  value: string
): Record<string, string> {
  if (!isDroidSpecPairOptionId(key) || value !== DROID_SPEC_SAME_AS_MAIN) {
    return { ...options, [key]: value }
  }
  const {
    [DROID_SPEC_MODEL_OPTION_ID]: model,
    [DROID_SPEC_EFFORT_OPTION_ID]: _effort,
    ...rest
  } = options
  return key === DROID_SPEC_EFFORT_OPTION_ID && model !== undefined
    ? { ...rest, [DROID_SPEC_MODEL_OPTION_ID]: model }
    : rest
}
