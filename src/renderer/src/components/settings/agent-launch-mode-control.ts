import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  agentLaunchModePreference,
  withAgentLaunchModePreference,
  type AgentLaunchModePreference
} from '../../../../shared/agent-launch-mode-preference'
import { isNativeChatEnabled } from '../../../../shared/structured-native-chat-launch-route'

export type AgentLaunchModeControl = {
  value: AgentLaunchModePreference
  /** The global switch the Follow value falls back to; only the words under the control read it. */
  chatUiSwitchOn: boolean
  onChange: (value: AgentLaunchModePreference) => void
}

type UpdateSettings = (updates: Partial<GlobalSettings>) => void | Promise<void>

export function buildDroidLaunchModeControl(
  settings: Pick<GlobalSettings, 'experimentalNativeChat' | 'agentLaunchModes'>,
  updateSettings: UpdateSettings
): AgentLaunchModeControl {
  return {
    value: agentLaunchModePreference(settings, 'droid'),
    chatUiSwitchOn: isNativeChatEnabled(settings),
    onChange: (value) =>
      void updateSettings({
        agentLaunchModes: withAgentLaunchModePreference(settings.agentLaunchModes, 'droid', value)
      })
  }
}
