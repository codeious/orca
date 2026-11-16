import { isRecord } from '../../shared/agent-status/child-work/agent-status-child-work-value-guards'
import type { ProjectModelLayers } from '../native-chat/agent-model-catalog/agent-project-model-override'

const DROID_MODEL_SETTINGS = [
  'model',
  'reasoningEffort',
  'specModeModel',
  'specModeReasoningEffort'
] as const

function setsModel(settings: Record<string, unknown>): boolean {
  return DROID_MODEL_SETTINGS.some((key) => settings[key] !== undefined)
}

/** Treat unreadable project settings as a possible model or effort override. */
export function droidSettingsMayPickModel(text: string): boolean {
  try {
    const settings: unknown = JSON.parse(text)
    if (!isRecord(settings)) {
      return true
    }
    if (setsModel(settings)) {
      return true
    }
    const defaults = settings.sessionDefaultSettings
    return defaults !== undefined && (!isRecord(defaults) || setsModel(defaults))
  } catch {
    return true
  }
}

export const DROID_PROJECT_MODEL_LAYERS: ProjectModelLayers = {
  files: ['.factory/settings.json', '.factory/settings.local.json'].map((path) => ({
    path,
    mayPickModel: droidSettingsMayPickModel
  }))
}
