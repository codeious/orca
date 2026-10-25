import type { AgentSessionOptionsResult } from '../../shared/agent-session-wire'
import {
  withLiveCatalogListing,
  type AgentModelCatalogLiveListing
} from '../native-chat/agent-model-catalog/agent-model-catalog-entry'
import {
  droidModelOptionsFromListing,
  droidOptionParams,
  droidOptionsAfterPick,
  droidReportedSessionOptions,
  droidStartCatalogListing,
  type DroidSavedPicks
} from './droid-model-options'

type Ask = (
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number | null }
) => Promise<unknown>

/** The model and effort one Droid child reported, and the listing its start hands the host. */
export class DroidSessionModel {
  private reported?: AgentSessionOptionsResult
  startListing?: AgentModelCatalogLiveListing

  capture(result: unknown, saved: DroidSavedPicks, resolvesConfig: boolean): void {
    const reported = droidReportedSessionOptions(result)
    if (!reported) {
      return
    }
    this.reported = reported
    this.startListing = droidStartCatalogListing(reported, {
      resolvesConfig,
      picked: saved.picked
    })
  }

  /** A later read lists again only when start named no models, and does not reteach the default. */
  async read(
    request: Ask
  ): Promise<ReturnType<typeof withLiveCatalogListing<AgentSessionOptionsResult>>> {
    if (!this.reported) {
      const listed = await request('droid.list_models', {}, { timeoutMs: 15_000 })
      this.reported = { models: droidModelOptionsFromListing(listed), current: {} }
    }
    return withLiveCatalogListing(this.reported)
  }

  async set(request: Ask, key: string, value: string): Promise<Readonly<Record<string, string>>> {
    if (key !== 'model' && key !== 'effort') {
      throw new Error(`Droid has no session option named ${key}`)
    }
    await request(
      'droid.update_session_settings',
      key === 'model' ? { modelId: value } : { reasoningEffort: value },
      { timeoutMs: 15_000 }
    )
    this.reported = droidOptionsAfterPick(this.reported, key, value)
    return { [key]: value }
  }

  /** A resumed session already exists, so a saved pick is a settings update rather than a new start. */
  async applySaved(
    request: Ask,
    saved: DroidSavedPicks,
    warn: (error: unknown) => void
  ): Promise<void> {
    const params = droidOptionParams(saved)
    if (!params.modelId && !params.reasoningEffort) {
      return
    }
    try {
      await request('droid.update_session_settings', params, { timeoutMs: 15_000 })
    } catch (error) {
      warn(error)
      return
    }
    if (saved.model) {
      this.reported = droidOptionsAfterPick(this.reported, 'model', saved.model)
    }
    if (saved.effort) {
      this.reported = droidOptionsAfterPick(this.reported, 'effort', saved.effort)
    }
  }
}
