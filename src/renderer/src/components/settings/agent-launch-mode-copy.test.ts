import { describe, expect, it } from 'vitest'
import { DROID_CHAT_VERSION_FLOOR } from '../../../../shared/droid-chat-version-floor'
import {
  getAgentLaunchModeFallbackNote,
  getAgentLaunchModeOptionLabel,
  getAgentLaunchModeResult,
  getAgentLaunchModeSearchKeywords,
  getAgentLaunchModeTitle
} from './agent-launch-mode-copy'

describe('the Droid launch mode words', () => {
  it('labels the control and its three options', () => {
    expect(getAgentLaunchModeTitle()).toBe('Launch mode')
    expect(getAgentLaunchModeOptionLabel('follow')).toBe('Follow Chat UI switch')
    expect(getAgentLaunchModeOptionLabel('terminal')).toBe('Terminal')
    expect(getAgentLaunchModeOptionLabel('chat')).toBe('Chat UI')
  })

  it.each([
    [
      'follow',
      true,
      'New Droid sessions open in Chat UI, because the Chat UI switch in Experimental is on.'
    ],
    [
      'follow',
      false,
      'New Droid sessions open in the terminal, because the Chat UI switch in Experimental is off.'
    ],
    [
      'terminal',
      true,
      'New Droid sessions open in the terminal, whatever the Chat UI switch says.'
    ],
    [
      'terminal',
      false,
      'New Droid sessions open in the terminal, whatever the Chat UI switch says.'
    ],
    ['chat', true, 'New Droid sessions open in Chat UI, whatever the Chat UI switch says.'],
    ['chat', false, 'New Droid sessions open in Chat UI, whatever the Chat UI switch says.']
  ] as const)('names the result for %s with the switch %s', (preference, chatUiSwitchOn, words) => {
    expect(getAgentLaunchModeResult({ preference, chatUiSwitchOn })).toBe(words)
  })

  it('names the release from the constant the launch check uses', () => {
    expect(getAgentLaunchModeFallbackNote()).toBe(
      `Droid always opens in the terminal on WSL and SSH workspaces, and when it is older than ${DROID_CHAT_VERSION_FLOOR}.`
    )
  })

  it('is found by what a person would type for it', () => {
    const keywords = getAgentLaunchModeSearchKeywords()
    for (const word of ['droid', 'launch', 'terminal', 'chat ui', 'follow']) {
      expect(keywords).toContain(word)
    }
  })
})
