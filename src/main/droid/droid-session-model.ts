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
  droidSpecPairParams,
  droidStartCatalogListing,
  type DroidSavedPicks
} from './droid-model-options'

const OPTION_REQUEST_TIMEOUT_MS = 15_000

type Ask = (
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number | null }
) => Promise<unknown>

/** The model and effort one Droid child reported, and the listing its start hands the host. */
export class DroidSessionModel {
  private reported?: AgentSessionOptionsResult
  startListing?: AgentModelCatalogLiveListing

  /** The picks this child holds, without asking Droid for anything. */
  get current(): AgentSessionOptionsResult['current'] {
    return this.reported?.current ?? {}
  }

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
      const listed = await request(
        'droid.list_models',
        {},
        { timeoutMs: OPTION_REQUEST_TIMEOUT_MS }
      )
      this.reported = { models: droidModelOptionsFromListing(listed), current: {} }
    }
    return withLiveCatalogListing(this.reported)
  }

  /** The main model or effort only: the Spec pair has its own keys and is never moved by this. */
  async set(request: Ask, key: string, value: string): Promise<Readonly<Record<string, string>>> {
    if (key !== 'model' && key !== 'effort') {
      throw new Error(`Droid has no session option named ${key}`)
    }
    await request(
      'droid.update_session_settings',
      droidOptionParams(key === 'model' ? { model: value } : { effort: value }),
      { timeoutMs: OPTION_REQUEST_TIMEOUT_MS }
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
    const params = { ...droidOptionParams(saved), ...droidSpecPairParams(saved) }
    if (Object.keys(params).length === 0) {
      return
    }
    try {
      await request('droid.update_session_settings', params, {
        timeoutMs: OPTION_REQUEST_TIMEOUT_MS
      })
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
