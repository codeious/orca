import type { AgentSessionOptionsResult } from '../../shared/agent-session-wire'
import { encodeStructuredAgentSessionOptionValue } from '../../shared/structured-agent-session-option-codec'
import { AgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import { DroidRpcError } from './droid-rpc-errors'
import type {
  DroidInteractionMode,
  DroidSettings,
  DroidStartSettings
} from './droid-session-settings'

type DroidCurrentOptions = AgentSessionOptionsResult['current'] & { planMode: boolean }

/**
 * Spec runs its own model and effort, so the model and effort a person sees follow the mode; where
 * Droid names none for Spec it runs the main ones. `requested` is the mode the start pinned, which
 * stands until Droid reports one.
 */
export function droidCurrentOptions(
  settings: DroidSettings,
  requested: DroidInteractionMode
): DroidCurrentOptions {
  const spec = (settings.interactionMode ?? requested) === 'spec'
  const model = (spec ? settings.specModeModelId : undefined) ?? settings.modelId
  const effort = (spec ? settings.specModeReasoningEffort : undefined) ?? settings.reasoningEffort
  return {
    planMode: spec,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    confirmed: [
      ...(settings.interactionMode ? ['planMode'] : []),
      ...(model ? ['model'] : []),
      ...(effort ? ['effort'] : [])
    ]
  }
}

/**
 * Asks Droid to change mode and answers with the whole map of picks the host keeps, as Droid
 * reported them: a mode it never reported is rejected rather than shown as changed.
 */
export async function setDroidSpecMode(
  update: (params: Partial<DroidStartSettings>) => Promise<DroidSettings | undefined>,
  requested: DroidInteractionMode,
  on: boolean
): Promise<Record<string, string>> {
  let reported: DroidSettings | undefined
  try {
    reported = await update({ interactionMode: on ? 'spec' : 'auto' })
  } catch (error) {
    throw error instanceof DroidRpcError ? new AgentSessionOptionRejectedError(error) : error
  }
  if (reported?.interactionMode === undefined) {
    throw new AgentSessionOptionRejectedError(new Error('Droid did not report the mode it holds'))
  }
  const current = droidCurrentOptions(reported, requested)
  const planMode = encodeStructuredAgentSessionOptionValue('planMode', current.planMode)
  return {
    ...(planMode === null ? {} : { planMode }),
    ...(current.model ? { model: current.model } : {}),
    ...(current.effort ? { effort: current.effort } : {})
  }
}
