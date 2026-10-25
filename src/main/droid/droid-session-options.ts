import type { AgentSessionOptionsResult } from '../../shared/agent-session-wire'
import { encodeStructuredAgentSessionOptionValue } from '../../shared/structured-agent-session-option-codec'
import { AgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import type { DroidSavedPicks } from './droid-model-options'
import { DroidRpcError } from './droid-rpc-errors'
import type { DroidSessionModel } from './droid-session-model'
import type {
  DroidInteractionMode,
  DroidReportedSettings,
  DroidSettings,
  DroidStartSettings
} from './droid-session-settings'

type DroidCurrentOptions = AgentSessionOptionsResult['current'] & { planMode: boolean }

type Request = (
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number | null; onId?: (id: string) => void }
) => Promise<unknown>

/**
 * Spec runs its own model and effort, so the model and effort a person sees follow the mode; where
 * Droid names none for Spec it runs the main ones, as the picks already held say, else as Droid
 * reports them. `requested` is the mode the start pinned, which stands until Droid reports one.
 */
function droidCurrentOptions(
  settings: DroidSettings,
  requested: DroidInteractionMode,
  held: AgentSessionOptionsResult['current'] = {}
): DroidCurrentOptions {
  const spec = (settings.interactionMode ?? requested) === 'spec'
  const specModel = spec ? settings.specModeModelId : undefined
  const specEffort = spec ? settings.specModeReasoningEffort : undefined
  const model = specModel ?? held.model ?? settings.modelId
  const effort = specEffort ?? held.effort ?? settings.reasoningEffort
  const confirmed = new Set<string>(held.confirmed)
  const reported: [string, string | undefined][] = [
    ['planMode', settings.interactionMode],
    ['model', specModel ?? settings.modelId],
    ['effort', specEffort ?? settings.reasoningEffort]
  ]
  for (const [key, value] of reported) {
    if (value) {
      confirmed.add(key)
    }
  }
  return {
    planMode: spec,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    confirmed: [...confirmed]
  }
}

/** What one Droid child holds and can be asked to change: its model, effort, mode and level. */
export class DroidSessionOptions {
  constructor(
    private readonly deps: {
      request: Request
      settings: DroidReportedSettings
      model: DroidSessionModel
      requested: DroidInteractionMode
      timeoutMs: number
    }
  ) {}

  async read(): ReturnType<DroidSessionModel['read']> {
    const { request, settings, model, requested } = this.deps
    const listed = await model.read(request)
    return { ...listed, current: droidCurrentOptions(settings.current, requested, listed.current) }
  }

  set(key: string, value: string): ReturnType<DroidSessionModel['set']> {
    return this.deps.model.set(this.deps.request, key, value)
  }

  /**
   * Answers with the whole map of picks the host keeps, as Droid reported them: a mode it never
   * reported is rejected rather than shown as changed.
   */
  async setSpec(on: boolean): Promise<Record<string, string>> {
    let reported: DroidSettings | undefined
    try {
      reported = await this.update({ interactionMode: on ? 'spec' : 'auto' })
    } catch (error) {
      throw error instanceof DroidRpcError ? new AgentSessionOptionRejectedError(error) : error
    }
    if (reported?.interactionMode === undefined) {
      throw new AgentSessionOptionRejectedError(new Error('Droid did not report the mode it holds'))
    }
    const { model, requested } = this.deps
    const current = droidCurrentOptions(reported, requested, model.current)
    const planMode = encodeStructuredAgentSessionOptionValue('planMode', current.planMode)
    return {
      ...(planMode === null ? {} : { planMode }),
      ...(current.model ? { model: current.model } : {}),
      ...(current.effort ? { effort: current.effort } : {})
    }
  }

  /** A load takes no settings, so what the session stored stands unless it is sent again. */
  async resume(
    wanted: DroidStartSettings,
    saved: DroidSavedPicks,
    warn: (error: unknown) => void
  ): Promise<DroidSettings['autonomyLevel']> {
    const reported = await this.update(wanted)
    await this.deps.model.applySaved(this.deps.request, saved, warn)
    return reported?.autonomyLevel
  }

  /** What Droid reported holding in answer to this update, if it reported at all. */
  private async update(params: Partial<DroidStartSettings>): Promise<DroidSettings | undefined> {
    const { request, settings, timeoutMs } = this.deps
    const sent: { id?: string } = {}
    await request('droid.update_session_settings', params, {
      timeoutMs,
      onId: (id) => {
        sent.id = id
      }
    })
    return sent.id === undefined ? undefined : settings.answerTo(sent.id)
  }
}
