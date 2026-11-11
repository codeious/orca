import { FilePenLine, Hand, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react-native'
import type { AgentChatPermissionModeIconName } from '../../../../../src/shared/agent-launch/permissions/agent-chat-permission-mode'
import type { SessionOptionDescriptor } from '../../../../../src/shared/native-chat/input/native-chat-session-options'
import { nativeChatPermissionChoiceMark } from '../../../../../src/shared/native-chat/input/native-chat-permission-choice-mark'
import { colors } from '../../../theme/mobile-theme'

function iconNamed(name: AgentChatPermissionModeIconName): LucideIcon {
  switch (name) {
    case 'Hand':
      return Hand
    case 'FilePenLine':
      return FilePenLine
    case 'ShieldCheck':
      return ShieldCheck
    case 'ShieldAlert':
      return ShieldAlert
  }
}

export function permissionChoiceColor(
  descriptor: SessionOptionDescriptor | undefined,
  value: string | undefined
): string | undefined {
  return descriptor &&
    value !== undefined &&
    nativeChatPermissionChoiceMark(descriptor, value).dangerous
    ? colors.statusAmber
    : undefined
}

export function permissionModeIcon(
  descriptor: SessionOptionDescriptor,
  value: string
): LucideIcon | undefined {
  const { icon } = nativeChatPermissionChoiceMark(descriptor, value)
  return icon ? iconNamed(icon) : undefined
}

export function permissionChoiceLeading(
  descriptor: SessionOptionDescriptor,
  value: string
): React.JSX.Element | null {
  const Icon = permissionModeIcon(descriptor, value)
  return Icon ? (
    <Icon
      size={18}
      color={permissionChoiceColor(descriptor, value) ?? colors.textSecondary}
      strokeWidth={2.2}
    />
  ) : null
}
