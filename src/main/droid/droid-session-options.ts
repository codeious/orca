import type { AgentSessionOptionsResult } from '../../shared/agent-session/options/agent-session-options-result'
import {
  DROID_AUTONOMY_OPTION_ID,
  isDroidAutonomyLevel,
  type DroidAutonomyLevel
} from '../../shared/droid-autonomy-options'
import {
  DROID_SPEC_EFFORT_OPTION_ID,
  DROID_SPEC_MODEL_OPTION_ID,
  DROID_SPEC_SAME_AS_MAIN
} from '../../shared/droid-spec-pair-options'
import { encodeStructuredAgentSessionOptionValue } from '../../shared/agent-session/options/structured-agent-session-option-codec'
import { AgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import {
  agentSessionFailureFact,
  providerDiagnostic
} from '../../shared/agent-session/failures/agent-session-failure'
import { isDroidMethodNotFound } from './droid-missing-method'
import { droidSpecPairParams, type DroidSavedPicks } from './droid-model-options'
import { DroidRpcError } from './droid-rpc-errors'
import { droidSessionOptionDescriptors } from './droid-session-option-descriptors'
import type { DroidSessionModel } from './droid-session-model'
import {
  parseDroidSettings,
  SPEC_PAIR_SETTINGS,
  type DroidInteractionMode,
  type DroidReportedSettings,
  type DroidSettings,
  type DroidStartSettings
} from './droid-session-settings'

type DroidCurrentOptions = AgentSessionOptionsResult['current'] & { planMode: boolean }

type Request = (
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number | null; onId?: (id: string) => void }
) => Promise<unknown>

/** The mode Droid reports, else the one the start pinned. */
function specIsOn(settings: DroidSettings, requested: DroidInteractionMode): boolean {
  return (settings.interactionMode ?? requested) === 'spec'
}

/** Saved picks keep the main pair, even while Spec runs a different one. */
function droidMainOptions(
  settings: DroidSettings,
  requested: DroidInteractionMode,
  held: AgentSessionOptionsResult['current'] = {}
): DroidCurrentOptions {
  const model = held.model ?? settings.modelId
  const effort = held.effort ?? settings.reasoningEffort
  const confirmed = new Set<string>(held.confirmed)
  const reported: [string, string | undefined][] = [
    ['planMode', settings.interactionMode],
    ['model', settings.modelId],
    ['effort', settings.reasoningEffort]
  ]
  for (const [key, value] of reported) {
    if (value) {
      confirmed.add(key)
    }
  }
  return {
    planMode: specIsOn(settings, requested),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    confirmed: [...confirmed]
  }
}

function droidCurrentOptions(
  settings: DroidSettings,
  requested: DroidInteractionMode,
  held: AgentSessionOptionsResult['current']
): DroidCurrentOptions {
  const current = droidMainOptions(settings, requested, held)
  if (!current.planMode) {
    return current
  }
  const model = settings.specModeModelId ?? current.model
  const effort =
    settings.specModeReasoningEffort ?? (settings.specModeModelId ? undefined : current.effort)
  const confirmed = new Set(current.confirmed)
  if (settings.specModeModelId) {
    confirmed.add('model')
  }
  if (settings.specModeReasoningEffort) {
    confirmed.add('effort')
  }
  if (!effort) {
    confirmed.delete('effort')
  }
  return { ...current, model, effort, confirmed: [...confirmed] }
}

/** What one Droid child holds and can be asked to change: its model, effort, mode and level. */
export class DroidSessionOptions {
  /** The level the person chose in the chat, kept in the stored picks; unset while Agent Permissions
   *  decides, so a model pick never pins the level Droid happened to report. */
  private chosenAutonomy: DroidAutonomyLevel | undefined

  constructor(
    private readonly deps: {
      request: Request
      settings: DroidReportedSettings
      model: DroidSessionModel
      requested: DroidInteractionMode
      pickedAutonomy?: DroidAutonomyLevel
      timeoutMs: number
    }
  ) {
    this.chosenAutonomy = deps.pickedAutonomy
  }

  async read(): ReturnType<DroidSessionModel['read']> {
    const { request, settings, model, requested } = this.deps
    const listed = await model.read(request)
    const answer = {
      ...listed,
      current: droidCurrentOptions(settings.current, requested, listed.current)
    }
    return { ...answer, sessionOptions: droidSessionOptionDescriptors(settings.current, answer) }
  }

  /**
   * Answers with the whole map of picks the host keeps: it stores what a pick returns as the
   * chat's options, so a bare `{ [key]: value }` would drop Spec and the other half of the pair.
   * Where Droid reported nothing for the pick, the picked value stands.
   */
  async set(key: string, value: string): Promise<Record<string, string>> {
    if (
      (key === 'model' || key === 'effort') &&
      specIsOn(this.deps.settings.current, this.deps.requested)
    ) {
      return this.setSpecPair(
        key === 'model' ? DROID_SPEC_MODEL_OPTION_ID : DROID_SPEC_EFFORT_OPTION_ID,
        value
      )
    }
    if (key === DROID_SPEC_MODEL_OPTION_ID || key === DROID_SPEC_EFFORT_OPTION_ID) {
      return this.setSpecPair(key, value)
    }
    if (key === DROID_AUTONOMY_OPTION_ID) {
      return this.setAutonomy(value)
    }
    const { request, settings, model } = this.deps
    const sent: { id?: string } = {}
    try {
      await model.set(
        (method, params, options) =>
          request(method, params, {
            ...options,
            onId: (id) => {
              sent.id = id
            }
          }),
        key,
        value
      )
    } catch (error) {
      // Droid's own sentence says why a model or effort is refused (an organization's policy, say).
      throw error instanceof DroidRpcError && !isDroidMethodNotFound(error)
        ? new AgentSessionOptionRejectedError(
            error,
            'optionRejected',
            agentSessionFailureFact('providerRejected', {
              detail: providerDiagnostic(error.message, 'person')
            })
          )
        : error
    }
    const answer = sent.id === undefined ? undefined : settings.answerTo(sent.id)
    const picks = this.picks(answer ?? settings.current)
    return answer ? picks : { ...picks, [key]: value }
  }

  /** Droid may run a lower level than asked for, so the stored level is the one it reports. */
  private async setAutonomy(value: string): Promise<Record<string, string>> {
    if (!isDroidAutonomyLevel(value)) {
      throw new Error('Choose an autonomy level Droid supports')
    }
    const { settings } = this.deps
    let answer: DroidSettings | undefined
    try {
      answer = await this.update({ autonomyLevel: value })
    } catch (error) {
      // The sentence is Orca's own, written for a person, so a client may quote it.
      throw isDroidMethodNotFound(error)
        ? new AgentSessionOptionRejectedError(
            new Error('Changing autonomy requires a newer Droid release'),
            'optionRejected'
          )
        : error
    }
    if (!answer) {
      settings.adopt({ autonomyLevel: value })
    }
    const next: DroidSettings = answer ?? { ...settings.current }
    this.chosenAutonomy = next.autonomyLevel ?? value
    return this.picks(next)
  }

  /** Clearing the Spec model clears the effort that belonged to it. Droid may report nothing after a
   *  clear, so the stale value is dropped here instead of waiting for a report. */
  private async setSpecPair(key: string, value: string): Promise<Record<string, string>> {
    const { settings } = this.deps
    const clear = value === DROID_SPEC_SAME_AS_MAIN
    const forModel = key === DROID_SPEC_MODEL_OPTION_ID
    const cleared: (typeof SPEC_PAIR_SETTINGS)[number][] = clear
      ? forModel
        ? [...SPEC_PAIR_SETTINGS]
        : ['specModeReasoningEffort']
      : []
    const params = clear
      ? Object.fromEntries(cleared.map((name) => [name, null]))
      : { [forModel ? 'specModeModelId' : 'specModeReasoningEffort']: value }
    const answer = await this.update(params)
    const next: DroidSettings = { ...(answer ?? settings.current) }
    if (clear) {
      settings.forgetSpecPair(cleared)
      for (const name of cleared) {
        delete next[name]
      }
    } else if (!answer) {
      settings.adopt(params)
      Object.assign(next, parseDroidSettings(params))
    }
    return this.picks(next)
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
    return this.picks(reported)
  }

  /** A load takes no settings, so what the session stored stands unless it is sent again. */
  async resume(
    wanted: DroidStartSettings,
    saved: DroidSavedPicks,
    warn: (error: unknown) => void
  ): Promise<DroidSettings['autonomyLevel']> {
    const reported = await this.update(wanted)
    if (await this.deps.model.applySaved(this.deps.request, saved, warn)) {
      this.deps.settings.adopt(droidSpecPairParams(saved))
    }
    return reported?.autonomyLevel
  }

  /** The Spec, model, effort, Spec pair and chosen level the host stores for a chat Droid holds as `reported`. */
  private picks(reported: DroidSettings): Record<string, string> {
    const { model, requested } = this.deps
    const current = droidMainOptions(reported, requested, model.current)
    const planMode = encodeStructuredAgentSessionOptionValue('planMode', current.planMode)
    return {
      ...(planMode === null ? {} : { planMode }),
      ...(current.model ? { model: current.model } : {}),
      ...(current.effort ? { effort: current.effort } : {}),
      ...(reported.specModeModelId
        ? { [DROID_SPEC_MODEL_OPTION_ID]: reported.specModeModelId }
        : {}),
      ...(reported.specModeReasoningEffort
        ? { [DROID_SPEC_EFFORT_OPTION_ID]: reported.specModeReasoningEffort }
        : {}),
      ...(this.chosenAutonomy ? { [DROID_AUTONOMY_OPTION_ID]: this.chosenAutonomy } : {})
    }
  }

  /** What Droid reported holding in answer to this update, if it reported at all. */
  private async update(params: object): Promise<DroidSettings | undefined> {
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
