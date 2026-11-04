import { z } from 'zod'
import {
  DROID_SPEC_EFFORT_OPTION_ID,
  DROID_SPEC_MODEL_OPTION_ID,
  DROID_SPEC_SAME_AS_MAIN
} from '../../shared/droid-spec-pair-options'
import type { AgentSessionModelOption } from '../../shared/agent-session/agent-session-wire'
import type { AgentSessionOptionsResult } from '../../shared/agent-session/options/agent-session-options-result'
import {
  unpickedSessionConfiguredChoice,
  withLiveCatalogListing,
  type AgentModelCatalogLiveListing
} from '../native-chat/agent-model-catalog/agent-model-catalog-entry'

const modelRow = z.looseObject({
  id: z.string().min(1),
  displayName: z.string().optional(),
  supportedReasoningEfforts: z.array(z.unknown()).optional(),
  isCustom: z.boolean().optional(),
  disabled: z.boolean().optional()
})

const modelList = z.looseObject({
  models: z.array(z.unknown())
})

/** Rows from `droid.list_models`. No `defaultEffort`: the row's default is not what a new chat runs. */
export function droidModelOptionsFromListing(result: unknown): AgentSessionModelOption[] {
  const parsed = modelList.safeParse(result)
  if (!parsed.success) {
    return []
  }
  const models: AgentSessionModelOption[] = []
  for (const row of parsed.data.models) {
    const option = droidModelOption(row)
    if (option) {
      models.push(option)
    }
  }
  return models
}

function droidModelOption(row: unknown): AgentSessionModelOption | null {
  const parsed = modelRow.safeParse(row)
  if (!parsed.success || parsed.data.disabled === true) {
    return null
  }
  const { id, displayName, isCustom } = parsed.data
  const efforts = (parsed.data.supportedReasoningEfforts ?? []).flatMap((value) =>
    typeof value === 'string' && value !== '' ? [{ value, label: value }] : []
  )
  return {
    id,
    label: displayName?.trim() || id,
    isDefault: false,
    efforts,
    ...(isCustom ? { isCustom: true as const } : {})
  }
}

const startedOptions = z.looseObject({
  settings: z
    .looseObject({
      modelId: z.string().min(1).optional(),
      reasoningEffort: z.string().min(1).optional()
    })
    .optional(),
  availableModels: z.array(z.unknown()).optional()
})

/** What initialize or load reported. Null when it listed no usable model, which teaches nothing. */
export function droidReportedSessionOptions(result: unknown): AgentSessionOptionsResult | null {
  const parsed = startedOptions.safeParse(result)
  if (!parsed.success || !parsed.data.availableModels) {
    return null
  }
  const models = droidModelOptionsFromListing({ models: parsed.data.availableModels })
  if (models.length === 0) {
    return null
  }
  const model = parsed.data.settings?.modelId
  const effort = parsed.data.settings?.reasoningEffort
  const confirmed = [
    ...(model ? (['model'] as const) : []),
    ...(effort ? (['effort'] as const) : [])
  ]
  return {
    models,
    current: {
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(confirmed.length > 0 ? { confirmed: [...confirmed] } : {})
    }
  }
}

export type DroidSavedPicks = {
  model?: string
  effort?: string
  /** The model and effort Spec runs on in place of the main pair. */
  specModel?: string | null
  specEffort?: string | null
  picked: ReadonlySet<string>
}

/** Model, effort and the Spec pair saved on the chat. Anything else is not a Droid session option. */
export function droidSavedOptionPicks(
  options: Readonly<Record<string, string>> | undefined
): DroidSavedPicks {
  const model = options?.model
  const effort = options?.effort
  const storedModel = options?.[DROID_SPEC_MODEL_OPTION_ID]
  const storedEffort = options?.[DROID_SPEC_EFFORT_OPTION_ID]
  const specModel = storedModel === DROID_SPEC_SAME_AS_MAIN ? null : storedModel
  const specEffort =
    specModel === null || storedEffort === DROID_SPEC_SAME_AS_MAIN ? null : storedEffort
  const picked = new Set<string>()
  if (model) {
    picked.add('model')
  }
  if (effort) {
    picked.add('effort')
  }
  return {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(specModel !== undefined ? { specModel } : {}),
    ...(specEffort !== undefined ? { specEffort } : {}),
    picked
  }
}

type DroidOptionParams = Partial<
  Record<'modelId' | 'reasoningEffort' | 'specModeModelId' | 'specModeReasoningEffort', string>
>

/** `spec` names the pair under the keys Spec reads, so it never moves the main model or effort. */
export function droidOptionParams(
  picks: Pick<DroidSavedPicks, 'model' | 'effort'>,
  spec = false
): DroidOptionParams {
  return {
    ...(picks.model ? { [spec ? 'specModeModelId' : 'modelId']: picks.model } : {}),
    ...(picks.effort
      ? { [spec ? 'specModeReasoningEffort' : 'reasoningEffort']: picks.effort }
      : {})
  }
}

/** Null clears a saved Spec value; initialize accepts only the non-null pair. */
export function droidSpecPairParams(
  saved: Pick<DroidSavedPicks, 'specModel' | 'specEffort'>,
  includeClears = true
): Partial<Record<'specModeModelId' | 'specModeReasoningEffort', string | null>> {
  return {
    ...(saved.specModel !== undefined && (includeClears || saved.specModel !== null)
      ? { specModeModelId: saved.specModel }
      : {}),
    ...(saved.specEffort !== undefined && (includeClears || saved.specEffort !== null)
      ? { specModeReasoningEffort: saved.specEffort }
      : {})
  }
}

/** A new session with no model pick teaches what it resolved. A resume or a restored pick does not. */
export function droidStartCatalogListing(
  options: AgentSessionOptionsResult,
  input: { resolvesConfig: boolean; picked: ReadonlySet<string> }
): AgentModelCatalogLiveListing {
  return withLiveCatalogListing(
    options,
    unpickedSessionConfiguredChoice({
      resolvesConfig: input.resolvesConfig,
      picked: input.picked,
      models: options.models,
      current: options.current
    })
  ).catalogListing
}

export function droidOptionsAfterPick(
  options: AgentSessionOptionsResult | undefined,
  key: 'model' | 'effort',
  value: string
): AgentSessionOptionsResult {
  const current = options?.current ?? {}
  const confirmed = new Set(current.confirmed ?? [])
  confirmed.add(key)
  return {
    models: options?.models ?? [],
    ...(options?.fastModeSupport ? { fastModeSupport: options.fastModeSupport } : {}),
    current: {
      ...current,
      ...(key === 'model' ? { model: value } : { effort: value }),
      confirmed: [...confirmed]
    }
  }
}
