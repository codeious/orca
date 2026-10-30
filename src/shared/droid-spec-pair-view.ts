// What the Spec model and effort control of a Droid chat shows and accepts. The pair is not a catalog
// option, so none of this goes through the record that tracks a model's options.

import type { CatalogModel } from './agent-session-option-catalog'
import { DROID_AUTONOMY_OPTION_ID } from './droid-autonomy-options'
import { withDroidAutonomyPick } from './droid-autonomy-view'
import {
  DROID_SPEC_MODEL_OPTION_ID,
  DROID_SPEC_PAIR_OPTION_IDS,
  DROID_SPEC_SAME_AS_MAIN,
  droidSpecPairAfterPick,
  droidSpecPairOf,
  isDroidSpecPairOptionId,
  type DroidSpecPair
} from './droid-spec-pair-options'
import { resolveEffectiveNativeChatModelId } from './native-chat-session-option-snapshot'
import type {
  SessionOptionSelectChoice,
  SessionOptionSpecPair
} from './native-chat-session-options'
import { structuredAgentSessionOptionView } from './structured-agent-session-option-view'
import {
  commitStructuredAgentSessionOptionValues,
  type StructuredAgentSessionOptionState
} from './structured-agent-session-options'

/** Only an agent whose Spec runs on its own model offers the pair, and only once models are listed. */
function listedModels(state: StructuredAgentSessionOptionState): readonly CatalogModel[] | null {
  const { catalog, catalogSource } = state
  if (!catalog?.offersSpecAtRest || (catalogSource !== 'host' && catalogSource !== 'live')) {
    return null
  }
  return catalog.models.length > 0 ? catalog.models : null
}

function withCurrent(
  choices: readonly SessionOptionSelectChoice[],
  current: string | undefined
): SessionOptionSelectChoice[] {
  return current && !choices.some((choice) => choice.value === current)
    ? [...choices, { value: current, label: current }]
    : [...choices]
}

function effortChoicesOf(model: CatalogModel | undefined): SessionOptionSelectChoice[] {
  const effort = model?.options.find((option) => option.id === 'effort')
  return effort?.kind.type === 'select' ? effort.kind.choices : []
}

/** The pair as a launch's held picks would leave it: a held pick is shown before the host has it.
 *  Until a session's answer names the pair, the launch's accepted picks are what the host holds. */
function pairWithHeld(
  state: StructuredAgentSessionOptionState,
  seed: Readonly<Record<string, string>> | undefined,
  held: Readonly<Record<string, string>>
): DroidSpecPair {
  let pair = state.specPair ?? droidSpecPairOf(seed)
  for (const id of DROID_SPEC_PAIR_OPTION_IDS) {
    const value = held[id]
    if (value !== undefined) {
      pair = droidSpecPairAfterPick(pair, id, value)
    }
  }
  return pair
}

/** The control's contents, or null for an agent without one or before its models are listed.
 *  With no Spec model set, the efforts offered are those of the state's main model. */
export function droidSpecPairSurface(
  state: StructuredAgentSessionOptionState,
  seed: Readonly<Record<string, string>> | undefined,
  held: Readonly<Record<string, string>>,
  settable: boolean
): SessionOptionSpecPair | null {
  const models = listedModels(state)
  if (!models || !state.catalog) {
    return null
  }
  const pair = pairWithHeld(state, seed, held)
  const effortModelId =
    pair.model ?? resolveEffectiveNativeChatModelId(state.catalog, models, state.record)
  return {
    model: pair.model ?? null,
    effort: pair.effort ?? null,
    modelChoices: withCurrent(
      models.map((model) => ({ value: model.id, label: model.label })),
      pair.model
    ),
    effortChoices: withCurrent(
      effortChoicesOf(models.find((model) => model.id === effortModelId)),
      pair.effort
    ),
    settable
  }
}

/** A pick the control offers: a listed model, an effort of the model Spec runs on, or the clear. */
export function canSetDroidSpecPairOption(
  state: StructuredAgentSessionOptionState,
  id: string,
  value: string,
  seed?: Readonly<Record<string, string>>,
  held: Readonly<Record<string, string>> = {}
): boolean {
  const surface = droidSpecPairSurface(state, seed, held, true)
  if (!surface || state.pendingId !== null || !isDroidSpecPairOptionId(id)) {
    return false
  }
  const choices = id === DROID_SPEC_MODEL_OPTION_ID ? surface.modelChoices : surface.effortChoices
  return value === DROID_SPEC_SAME_AS_MAIN || choices.some((choice) => choice.value === value)
}

/** The state once the host has accepted a pick of the pair; no main option is touched. */
export function withDroidSpecPairPick(
  state: StructuredAgentSessionOptionState,
  id: string,
  value: string
): StructuredAgentSessionOptionState {
  return {
    ...state,
    specPair: droidSpecPairAfterPick(state.specPair ?? {}, id, value),
    pendingId: null
  }
}

/** The control once held and seeded picks are applied, so a held main model is the one in force. */
export function droidSpecPairSurfaceOf(
  state: StructuredAgentSessionOptionState,
  seed: Readonly<Record<string, string>> | undefined,
  held: Readonly<Record<string, string>>,
  settable: boolean
): SessionOptionSpecPair | null {
  return droidSpecPairSurface(
    structuredAgentSessionOptionView(state, seed, held),
    seed,
    held,
    settable
  )
}

/** The state once the host has accepted any pick: the pair and the autonomy level are their own,
 *  every other id is an option. The level shown is the one the host kept, which may be lower. */
export function commitStructuredAgentSessionPick(
  state: StructuredAgentSessionOptionState,
  id: string,
  value: string,
  committed: Readonly<Record<string, string>>
): StructuredAgentSessionOptionState {
  if (id === DROID_AUTONOMY_OPTION_ID) {
    return withDroidAutonomyPick(state, committed[DROID_AUTONOMY_OPTION_ID] ?? value)
  }
  return isDroidSpecPairOptionId(id)
    ? withDroidSpecPairPick(state, id, value)
    : commitStructuredAgentSessionOptionValues(state, committed)
}
