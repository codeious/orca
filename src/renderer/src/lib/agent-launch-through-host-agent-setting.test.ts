import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../shared/global-settings-types'

const settingsRef = vi.hoisted((): { current: Partial<GlobalSettings> } => ({ current: {} }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ settings: settingsRef.current }) }
}))
vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  callRuntimeRpc: vi.fn()
}))

const { windowMakesHostLaunchTab } = await import('./agent-launch-through-host')

beforeEach(() => {
  settingsRef.current = {}
})

// The window makes the tab only where main's own launch applies: the host cannot turn it into a chat.
describe('windowMakesHostLaunchTab with a per-agent launch setting', () => {
  it('makes the tab for every agent while nothing can open a chat', () => {
    settingsRef.current = { experimentalNativeChat: false }

    expect(windowMakesHostLaunchTab('droid')).toBe(true)
  })

  it('leaves the tab to the host for an agent set to Chat while the switch is off', () => {
    settingsRef.current = { experimentalNativeChat: false, agentLaunchModes: { droid: 'chat' } }

    expect(windowMakesHostLaunchTab('droid')).toBe(false)
    expect(windowMakesHostLaunchTab('claude')).toBe(true)
  })

  it('makes the tab for an agent set to Terminal while the switch is on', () => {
    settingsRef.current = { experimentalNativeChat: true, agentLaunchModes: { droid: 'terminal' } }

    expect(windowMakesHostLaunchTab('droid')).toBe(true)
    expect(windowMakesHostLaunchTab('claude')).toBe(false)
  })
})
