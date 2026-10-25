import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore } from './store-test-helpers'
import type { AppState } from '../types'
import { mergeSettings } from '../../web/preload-api/web-preference-normalization'
import { getDefaultSettings } from '../../../../shared/constants'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

const settingsSet = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { api: { settings: { get: vi.fn(), set: settingsSet } } })
})

describe('the renderer settings write of agentLaunchModes', () => {
  it('sends the normalized map over IPC', async () => {
    const store = createTestStore()
    store.setState({ settings: { notifications: {} } as unknown as AppState['settings'] })

    await store.getState().updateSettingsOrThrow({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a stale caller can hand the store any JSON; the write must drop it.
      agentLaunchModes: { droid: 'chat', claude: 'follow', nope: 'chat' } as never
    })

    expect(settingsSet).toHaveBeenCalledWith({ agentLaunchModes: { droid: 'chat' } })
  })
})

describe('the web client settings merge of agentLaunchModes', () => {
  it('keeps the saved map when a later write names other settings', () => {
    const base = { ...getDefaultSettings('~'), agentLaunchModes: { droid: 'chat' as const } }

    expect(mergeSettings(base, { compactWorktreeCards: true }).agentLaunchModes).toEqual({
      droid: 'chat'
    })
  })

  it('replaces the map with the written one, dropping Follow and unknown entries', () => {
    const base = { ...getDefaultSettings('~'), agentLaunchModes: { droid: 'chat' as const } }

    expect(
      mergeSettings(base, {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: browser-stored settings can hold any JSON; the merge must drop it.
        agentLaunchModes: { droid: 'follow', claude: 'terminal', nope: 'chat' } as never
      }).agentLaunchModes
    ).toEqual({ claude: 'terminal' })
  })
})
