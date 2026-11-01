import { describe, expect, it, vi } from 'vitest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { updateSettings, type SettingsMutationOperations } from './settings-update'

function makeOperations(): SettingsMutationOperations {
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields updateSettings reads for this setting.
    state: { settings: {}, repos: [] } as unknown as PersistedState,
    bumpLocalWorktreeScanGeneration: vi.fn(),
    removeRetainedBlob: vi.fn(),
    scheduleSave: vi.fn(),
    notifySettingsChanged: vi.fn()
  }
}

// Desktop IPC, the web RPC and the CLI all reach the store through this boundary.
describe('updateSettings agentLaunchModes', () => {
  it('stores Terminal and Chat per agent', () => {
    const operations = makeOperations()

    expect(
      updateSettings(operations, { agentLaunchModes: { droid: 'chat', claude: 'terminal' } })
        .agentLaunchModes
    ).toEqual({ droid: 'chat', claude: 'terminal' })
  })

  it('drops Follow, so an agent that follows the switch has no entry', () => {
    const operations = makeOperations()
    updateSettings(operations, { agentLaunchModes: { droid: 'chat' } })

    expect(
      updateSettings(operations, {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Follow is the missing-key default, so a client that still sends it must not store it.
        agentLaunchModes: { droid: 'follow' } as never
      }).agentLaunchModes
    ).toEqual({})
  })

  it('drops unknown agents and values a hand-built client sends', () => {
    const operations = makeOperations()

    expect(
      updateSettings(operations, {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a hand-built client can send any JSON; the boundary must drop it.
        agentLaunchModes: { droid: 'structured', nope: 'chat', codex: 'chat' } as never
      }).agentLaunchModes
    ).toEqual({ codex: 'chat' })
  })

  it('reports the normalized map to listeners, not the raw write', () => {
    const operations = makeOperations()

    updateSettings(
      operations,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a hand-built client can send any JSON; the boundary must drop it.
      { agentLaunchModes: { droid: 'chat', nope: 'chat' } as never },
      { notifyListeners: true }
    )

    expect(operations.notifySettingsChanged).toHaveBeenCalledWith(
      { agentLaunchModes: { droid: 'chat' } },
      undefined
    )
  })
})
