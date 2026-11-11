import type { StructuredPlanModePair } from './agent-session/options/structured-agent-session-plan-mode-pair'

/** Spec's model and effort belong to the session, not to per-model launch defaults. */
export const DROID_SPEC_MODEL_OPTION_ID = 'specModel'
export const DROID_SPEC_EFFORT_OPTION_ID = 'specEffort'

/** The choice that clears a Spec value: no model id can be this, and a pick is a non-empty string. */
export const DROID_SPEC_SAME_AS_MAIN = 'same-as-main'

export const DROID_PLAN_MODE_PAIR: StructuredPlanModePair = {
  modelOptionId: DROID_SPEC_MODEL_OPTION_ID,
  effortOptionId: DROID_SPEC_EFFORT_OPTION_ID,
  sameAsMain: DROID_SPEC_SAME_AS_MAIN
}
