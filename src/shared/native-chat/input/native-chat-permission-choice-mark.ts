import {
  AGENT_CHAT_PERMISSION_MODE_ICON_NAMES,
  AGENT_CHAT_PERMISSION_MODE_OPTION_ID,
  isAgentChatPermissionMode,
  type AgentChatPermissionModeIconName
} from '../../agent-launch/permissions/agent-chat-permission-mode'
import type { SessionOptionDescriptor } from './native-chat-session-options'

/** How a permission choice is marked: shared modes carry their own, other options declare it per choice. */
export function nativeChatPermissionChoiceMark(
  descriptor: SessionOptionDescriptor,
  value: string
): { icon?: AgentChatPermissionModeIconName; dangerous: boolean } {
  if (descriptor.id === AGENT_CHAT_PERMISSION_MODE_OPTION_ID) {
    return isAgentChatPermissionMode(value)
      ? { icon: AGENT_CHAT_PERMISSION_MODE_ICON_NAMES[value], dangerous: value === 'full-access' }
      : { dangerous: false }
  }
  const choice =
    descriptor.kind.type === 'select'
      ? descriptor.kind.choices.find((entry) => entry.value === value)
      : undefined
  return { icon: choice?.icon, dangerous: choice?.dangerous === true }
}
