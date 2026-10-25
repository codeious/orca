import { describe, expect, it } from 'vitest'
import { NativeChatSessionOptionsMutation } from './client-settings-params'

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
