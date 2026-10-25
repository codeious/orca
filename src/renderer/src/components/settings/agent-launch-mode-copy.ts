import { translate } from '@/i18n/i18n'
import type { AgentLaunchModePreference } from '../../../../shared/agent-launch-mode-preference'
import { DROID_CHAT_VERSION_FLOOR } from '../../../../shared/droid-chat-version-floor'
import { searchKeywords } from './settings-search-keywords'

export function getAgentLaunchModeTitle(): string {
  return translate('auto.components.settings.agent-launch-mode-copy.title', 'Launch mode')
}

export function getAgentLaunchModeDescription(): string {
  return translate(
    'auto.components.settings.agent-launch-mode-copy.description',
    'Choose whether new Droid sessions open in the terminal or in Chat UI.'
  )
}

export function getAgentLaunchModeOptionLabel(preference: AgentLaunchModePreference): string {
  if (preference === 'terminal') {
    return translate('auto.components.settings.agent-launch-mode-copy.terminal', 'Terminal')
  }
  if (preference === 'chat') {
    return translate('auto.components.settings.agent-launch-mode-copy.chat', 'Chat UI')
  }
  return translate(
    'auto.components.settings.agent-launch-mode-copy.follow',
    'Follow Chat UI switch'
  )
}

/** What a new Droid launch does, given the setting and the global switch it falls back to. */
export function getAgentLaunchModeResult({
  preference,
  chatUiSwitchOn
}: {
  preference: AgentLaunchModePreference
  chatUiSwitchOn: boolean
}): string {
  if (preference === 'terminal') {
    return translate(
      'auto.components.settings.agent-launch-mode-copy.resultTerminal',
      'New Droid sessions open in the terminal, whatever the Chat UI switch says.'
    )
  }
  if (preference === 'chat') {
    return translate(
      'auto.components.settings.agent-launch-mode-copy.resultChat',
      'New Droid sessions open in Chat UI, whatever the Chat UI switch says.'
    )
  }
  return chatUiSwitchOn
    ? translate(
        'auto.components.settings.agent-launch-mode-copy.resultFollowOn',
        'New Droid sessions open in Chat UI, because the Chat UI switch in Experimental is on.'
      )
    : translate(
        'auto.components.settings.agent-launch-mode-copy.resultFollowOff',
        'New Droid sessions open in the terminal, because the Chat UI switch in Experimental is off.'
      )
}

/** Shown in every state: the pane cannot know the open workspace's host or Droid's version. */
export function getAgentLaunchModeFallbackNote(): string {
  return translate(
    'auto.components.settings.agent-launch-mode-copy.fallbackNote',
    'Droid always opens in the terminal on WSL and SSH workspaces, and when it is older than {{value0}}.',
    { value0: DROID_CHAT_VERSION_FLOOR }
  )
}

export function getAgentLaunchModeSearchKeywords(): string[] {
  return searchKeywords([
    {
      key: 'auto.components.settings.agent-launch-mode-copy.search.droid',
      fallback: 'droid',
      englishOnly: true
    },
    { key: 'auto.components.settings.agent-launch-mode-copy.search.launch', fallback: 'launch' },
    { key: 'auto.components.settings.agent-launch-mode-copy.search.mode', fallback: 'mode' },
    {
      key: 'auto.components.settings.agent-launch-mode-copy.search.terminal',
      fallback: 'terminal'
    },
    { key: 'auto.components.settings.agent-launch-mode-copy.search.chat', fallback: 'chat' },
    {
      key: 'auto.components.settings.agent-launch-mode-copy.search.chatUi',
      fallback: 'chat ui'
    },
    { key: 'auto.components.settings.agent-launch-mode-copy.search.follow', fallback: 'follow' },
    {
      key: 'auto.components.settings.agent-launch-mode-copy.search.session',
      fallback: 'session'
    }
  ])
}
