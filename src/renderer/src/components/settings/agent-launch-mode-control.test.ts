import { describe, expect, it, vi } from 'vitest'
import { buildDroidLaunchModeControl } from './agent-launch-mode-control'

describe('the Droid launch mode control', () => {
  it('reads Follow when Droid has no entry, and the switch as the global setting', () => {
    const control = buildDroidLaunchModeControl({ experimentalNativeChat: true }, vi.fn())

    expect(control).toMatchObject({ value: 'follow', chatUiSwitchOn: true })
    expect(
      buildDroidLaunchModeControl({ experimentalNativeChat: false }, vi.fn()).chatUiSwitchOn
    ).toBe(false)
  })

  it('reads the stored value for Droid only', () => {
    const settings = {
      experimentalNativeChat: false,
      agentLaunchModes: { claude: 'terminal' }
    } as const

    expect(buildDroidLaunchModeControl(settings, vi.fn()).value).toBe('follow')
    expect(
      buildDroidLaunchModeControl({ ...settings, agentLaunchModes: { droid: 'chat' } }, vi.fn())
        .value
    ).toBe('chat')
  })

  it('writes the map with Droid set, keeping every other agent', () => {
    const updateSettings = vi.fn()
    const control = buildDroidLaunchModeControl(
      { experimentalNativeChat: false, agentLaunchModes: { claude: 'chat' } },
      updateSettings
    )

    control.onChange('terminal')

    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      agentLaunchModes: { claude: 'chat', droid: 'terminal' }
    })
  })

  it('removes Droid from the map for Follow instead of storing it', () => {
    const updateSettings = vi.fn()
    const control = buildDroidLaunchModeControl(
      { experimentalNativeChat: true, agentLaunchModes: { droid: 'chat' } },
      updateSettings
    )

    control.onChange('follow')

    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ agentLaunchModes: {} })
  })
})
