import { FilePenLine, Hand, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react-native'
import {
  AGENT_CHAT_PERMISSION_MODE_ICON_NAMES,
  isAgentChatPermissionMode
} from '../../../../../src/shared/agent-chat-permission-mode'
import {
  DROID_AUTONOMY_OPTION_ID,
  isDroidAutonomyLevel
} from '../../../../../src/shared/droid-autonomy-options'
import { colors } from '../../../theme/mobile-theme'

export function permissionChoiceColor(
  optionId: string | undefined,
  value: string | undefined
): string | undefined {
  return (optionId === DROID_AUTONOMY_OPTION_ID ? value === 'high' : value === 'full-access')
    ? colors.statusAmber
    : undefined
}

const DROID_PERMISSION_ICONS = {
  off: Hand,
  low: FilePenLine,
  medium: ShieldCheck,
  high: ShieldAlert
}

export function permissionModeIcon(optionId: string, value: string): LucideIcon | undefined {
  if (optionId === DROID_AUTONOMY_OPTION_ID) {
    return isDroidAutonomyLevel(value) ? DROID_PERMISSION_ICONS[value] : undefined
  }
  if (!isAgentChatPermissionMode(value)) {
    return undefined
  }
  switch (AGENT_CHAT_PERMISSION_MODE_ICON_NAMES[value]) {
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

export function permissionChoiceLeading(optionId: string, value: string): React.JSX.Element | null {
  const Icon = permissionModeIcon(optionId, value)
  return Icon ? (
    <Icon
      size={18}
      color={permissionChoiceColor(optionId, value) ?? colors.textSecondary}
      strokeWidth={2.2}
    />
  ) : null
}
