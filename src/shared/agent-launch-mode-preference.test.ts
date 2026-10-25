import { describe, expect, it } from 'vitest'
import {
  agentLaunchModePreference,
  normalizeAgentLaunchModePreferences
} from './agent-launch-mode-preference'
import {
  isNativeChatLaunchable,
  resolveNativeChatLaunchChoice
} from './structured-native-chat-launch-route'

describe('agent launch mode preferences', () => {
  it('reads a missing entry as Follow', () => {
    expect(agentLaunchModePreference(undefined, 'droid')).toBe('follow')
    expect(agentLaunchModePreference({}, 'droid')).toBe('follow')
    expect(agentLaunchModePreference({ agentLaunchModes: { claude: 'chat' } }, 'droid')).toBe(
      'follow'
    )
    expect(agentLaunchModePreference({ agentLaunchModes: { droid: 'chat' } }, undefined)).toBe(
      'follow'
    )
  })

  it('keeps Terminal and Chat, and drops Follow, unknown agents, and unknown values', () => {
    expect(
      normalizeAgentLaunchModePreferences({
        droid: 'chat',
        claude: 'terminal',
        codex: 'follow',
        gemini: 'structured',
        notAnAgent: 'chat',
        aider: 7
      })
    ).toEqual({ droid: 'chat', claude: 'terminal' })
  })

  it('reads anything that is not a record as no preferences', () => {
    expect(normalizeAgentLaunchModePreferences(undefined)).toEqual({})
    expect(normalizeAgentLaunchModePreferences(null)).toEqual({})
    expect(normalizeAgentLaunchModePreferences('chat')).toEqual({})
    expect(normalizeAgentLaunchModePreferences(['chat'])).toEqual({})
  })
})

describe('resolveNativeChatLaunchChoice', () => {
  it('follows the Chat UI switch when the agent has no setting', () => {
    expect(resolveNativeChatLaunchChoice({ experimentalNativeChat: true }, 'droid')).toEqual({
      structured: true,
      source: 'switch'
    })
    expect(resolveNativeChatLaunchChoice({ experimentalNativeChat: false }, 'droid')).toEqual({
      structured: false,
      source: 'switch'
    })
    expect(resolveNativeChatLaunchChoice(null, 'droid')).toEqual({
      structured: false,
      source: 'switch'
    })
  })

  it('lets Terminal keep an agent in a terminal while the switch is on', () => {
    expect(
      resolveNativeChatLaunchChoice(
        { experimentalNativeChat: true, agentLaunchModes: { droid: 'terminal' } },
        'droid'
      )
    ).toEqual({ structured: false, source: 'agent_setting' })
  })

  it('lets Chat open a chat while the switch is off', () => {
    expect(
      resolveNativeChatLaunchChoice(
        { experimentalNativeChat: false, agentLaunchModes: { droid: 'chat' } },
        'droid'
      )
    ).toEqual({ structured: true, source: 'agent_setting' })
  })

  it('leaves every other agent on the switch', () => {
    const settings = {
      experimentalNativeChat: true,
      agentLaunchModes: { droid: 'terminal' as const }
    }
    expect(resolveNativeChatLaunchChoice(settings, 'claude')).toEqual({
      structured: true,
      source: 'switch'
    })
  })
})

describe('isNativeChatLaunchable', () => {
  it('is true when the switch is on or any agent is set to Chat', () => {
    expect(isNativeChatLaunchable({ experimentalNativeChat: true })).toBe(true)
    expect(isNativeChatLaunchable({ agentLaunchModes: { droid: 'chat' } })).toBe(true)
  })

  it('is false when neither the switch nor any agent asks for a chat', () => {
    expect(isNativeChatLaunchable(null)).toBe(false)
    expect(isNativeChatLaunchable({ experimentalNativeChat: false })).toBe(false)
    expect(isNativeChatLaunchable({ agentLaunchModes: { droid: 'terminal' } })).toBe(false)
  })
})
