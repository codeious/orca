import { describe, expect, it } from 'vitest'
import { NativeChatSessionOptionsMutation, SettingsUpdate } from './client-settings-params'

describe('SettingsUpdate agentLaunchModes', () => {
  it('keeps Terminal and Chat, and drops Follow, unknown agents, and unknown values', () => {
    const parsed = SettingsUpdate.parse({
      agentLaunchModes: { droid: 'chat', claude: 'terminal', codex: 'follow', nope: 'chat' }
    })

    expect(parsed.agentLaunchModes).toEqual({ droid: 'chat', claude: 'terminal' })
  })

  it('reads a malformed map as no preferences', () => {
    expect(SettingsUpdate.parse({ agentLaunchModes: 'chat' }).agentLaunchModes).toEqual({})
  })
})

const mutation = (optionId: string, value: unknown) => ({
  type: 'apply-picks',
  agent: 'droid',
  picks: [{ modelId: 'opus', optionId, value }]
})

describe('native chat option picks', () => {
  it('accepts the Spec toggle as a boolean pick', () => {
    expect(NativeChatSessionOptionsMutation.safeParse(mutation('planMode', true)).success).toBe(
      true
    )
  })

  it('refuses a Spec pick that is not a boolean', () => {
    expect(NativeChatSessionOptionsMutation.safeParse(mutation('planMode', 'spec')).success).toBe(
      false
    )
  })
})
