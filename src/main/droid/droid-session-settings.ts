import { z } from 'zod'
import { decodeStructuredAgentSessionOptionValue } from '../../shared/structured-agent-session-option-codec'
import { isDroidAutonomyLevel, type DroidAutonomyLevel } from './droid-autonomy-level'

/** Never `mission`: those spend the person's credits unattended. */
export type DroidInteractionMode = 'auto' | 'spec'

/** What a start or resume pins on the session; the level and mode it stored are never inherited. */
export type DroidStartSettings = {
  autonomyLevel: DroidAutonomyLevel
  interactionMode: DroidInteractionMode
}

/** Spec is the saved `planMode` pick; anything that is not a stored `true` starts in auto. */
export function droidInteractionModeFromSavedOptions(
  options: Readonly<Record<string, string>> | undefined
): DroidInteractionMode {
  const saved = options?.planMode
  return saved !== undefined && decodeStructuredAgentSessionOptionValue('planMode', saved) === true
    ? 'spec'
    : 'auto'
}

/** The settings fields Orca reads from a Droid report. The legacy `autonomyMode` is ignored. */
export type DroidSettings = {
  modelId?: string
  reasoningEffort?: string
  interactionMode?: DroidInteractionMode
  autonomyLevel?: DroidAutonomyLevel
  availableAutonomyLevels?: DroidAutonomyLevel[]
  specModeModelId?: string
  specModeReasoningEffort?: string
}

const settingsRecord = z.record(z.string(), z.unknown())

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function interactionModeOf(value: unknown): DroidInteractionMode | undefined {
  return value === 'auto' || value === 'spec' ? value : undefined
}

/** A level or mode Droid has not defined is dropped, so a newer Droid never breaks an older Orca. */
export function parseDroidSettings(value: unknown): DroidSettings {
  const record = settingsRecord.safeParse(value)
  if (!record.success) {
    return {}
  }
  const { data } = record
  const modelId = nonEmptyText(data.modelId)
  const reasoningEffort = nonEmptyText(data.reasoningEffort)
  const interactionMode = interactionModeOf(data.interactionMode)
  const autonomyLevel = isDroidAutonomyLevel(data.autonomyLevel) ? data.autonomyLevel : undefined
  const specModeModelId = nonEmptyText(data.specModeModelId)
  const specModeReasoningEffort = nonEmptyText(data.specModeReasoningEffort)
  const available = Array.isArray(data.availableAutonomyLevels)
    ? data.availableAutonomyLevels.filter(isDroidAutonomyLevel)
    : undefined
  return {
    ...(modelId ? { modelId } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(interactionMode ? { interactionMode } : {}),
    ...(autonomyLevel ? { autonomyLevel } : {}),
    ...(available ? { availableAutonomyLevels: available } : {}),
    ...(specModeModelId ? { specModeModelId } : {}),
    ...(specModeReasoningEffort ? { specModeReasoningEffort } : {})
  }
}

const KEPT_ANSWERS = 16

/**
 * Droid sends the settings it holds as partial, unsolicited `settings_updated` reports, and one
 * more tagged with the `requestId` of the update that caused it, so each report merges over the last.
 */
export class DroidReportedSettings {
  private reported: DroidSettings = {}
  // A request that fails never claims its answer, so only the newest are kept.
  private readonly answers = new Map<string, DroidSettings>()

  get current(): DroidSettings {
    return this.reported
  }

  receive(report: { requestId?: string; settings: unknown }): void {
    this.adopt(report.settings)
    if (!report.requestId) {
      return
    }
    this.answers.set(report.requestId, this.reported)
    for (const stale of [...this.answers.keys()].slice(0, -KEPT_ANSWERS)) {
      this.answers.delete(stale)
    }
  }

  /** Settings an RPC result repeats; the unsolicited report can arrive before the result does. */
  adopt(settings: unknown): void {
    this.reported = { ...this.reported, ...parseDroidSettings(settings) }
  }

  /** What Droid held when it reported on this request, once. */
  answerTo(requestId: string): DroidSettings | undefined {
    const answer = this.answers.get(requestId)
    this.answers.delete(requestId)
    return answer
  }
}
