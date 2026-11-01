import { describe, expect, it } from 'vitest'
import { RuntimeClientSettingsController } from './runtime-client-settings'
import { createGlobalSettingsFixture } from '../../shared/global-settings-test-fixture'
import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  decideAgentLaunchMode,
  readAgentLaunchModeSettings
} from '../agent-launch/agent-launch-mode'

// Every host launch path (mobile create, CLI create, orchestration worker) reads the launch mode
// from this projection, so a setting missing here is a setting those paths never honour.
function controllerOf(settings: Partial<GlobalSettings>) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: get() reads nothing but store.getSettings(); every other RuntimeStore member is unreachable from that path.
  return new RuntimeClientSettingsController({ getSettings: () => settings } as never)
}

function hostSettings(overrides: Partial<GlobalSettings>): Partial<GlobalSettings> {
  return { ...createGlobalSettingsFixture({ workspaceDir: '/w' }), ...overrides }
}

describe('RuntimeClientSettingsController agent launch modes projection', () => {
  it('publishes the per-agent launch modes to host launch paths', () => {
    const projected = controllerOf(hostSettings({ agentLaunchModes: { droid: 'chat' } })).get()

    expect(projected.agentLaunchModes).toEqual({ droid: 'chat' })
  })

  it('reports no per-agent modes when the host has none saved', () => {
    const settings = hostSettings({})
    delete settings.agentLaunchModes

    expect(controllerOf(settings).get().agentLaunchModes).toEqual({})
  })

  it('reaches the launch decision a mobile or CLI create makes on the host', () => {
    const runtime = {
      getClientSettings: () =>
        controllerOf(
          hostSettings({ experimentalNativeChat: true, agentLaunchModes: { droid: 'terminal' } })
        ).get()
    }

    expect(
      decideAgentLaunchMode({
        placement: { agent: 'droid', workspaceKind: 'git-worktree' },
        settings: readAgentLaunchModeSettings(runtime)
      })
    ).toMatchObject({ mode: 'terminal', reason: 'agent_setting' })
  })

  it('accepts a write of the per-agent launch modes', async () => {
    const written: Partial<GlobalSettings>[] = []
    const settings = hostSettings({})
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: update() reads only getSettings and updateSettings on this path.
    const controller = new RuntimeClientSettingsController({
      getSettings: () => settings,
      updateSettings: (updates: Partial<GlobalSettings>) => {
        written.push(updates)
        Object.assign(settings, updates)
        return settings
      }
    } as never)

    const projected = await controller.update({ agentLaunchModes: { droid: 'chat' } })

    expect(written).toEqual([{ agentLaunchModes: { droid: 'chat' } }])
    expect(projected.agentLaunchModes).toEqual({ droid: 'chat' })
  })
})
