import { describe, expect, it } from 'vitest'
import { createTabBarAgentProjectionSelector } from './tab-agent-types-by-tab-id'

describe('tab bar projection of whether chats can open', () => {
  it('is on when an agent is set to Chat and the Chat UI switch is off', () => {
    const select = createTabBarAgentProjectionSelector()

    expect(
      select({ settings: { experimentalNativeChat: false, agentLaunchModes: { droid: 'chat' } } })
        .nativeChatEnabled
    ).toBe(true)
  })

  it('is on when the switch is on and no agent is set to Chat', () => {
    const select = createTabBarAgentProjectionSelector()

    expect(
      select({
        settings: { experimentalNativeChat: true, agentLaunchModes: { droid: 'terminal' } }
      }).nativeChatEnabled
    ).toBe(true)
  })

  it('is off when the switch is off and no agent is set to Chat', () => {
    const select = createTabBarAgentProjectionSelector()

    expect(
      select({
        settings: { experimentalNativeChat: false, agentLaunchModes: { droid: 'terminal' } }
      }).nativeChatEnabled
    ).toBe(false)
  })
})
