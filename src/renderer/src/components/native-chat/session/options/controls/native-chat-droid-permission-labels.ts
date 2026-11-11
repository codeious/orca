import { translate } from '@/i18n/i18n'
import {
  DROID_AUTONOMY_OPTION_ID,
  isDroidAutonomyLevel
} from '../../../../../../../shared/droid-autonomy-options'
import type { NativeChatDeclaredChoiceCopy } from './native-chat-permission-mode-labels'

function droidPermissionChoiceCopy(value: string): ReturnType<NativeChatDeclaredChoiceCopy> {
  if (!isDroidAutonomyLevel(value)) {
    return undefined
  }
  switch (value) {
    case 'off':
      return {
        label: translate('components.native-chat.composer.autonomyPermissionOff', 'Off'),
        description: translate(
          'components.native-chat.composer.autonomyPermissionOffDescription',
          'Asks before edits and commands'
        )
      }
    case 'low':
      return {
        label: translate('components.native-chat.composer.autonomyPermissionLow', 'Low'),
        description: translate(
          'components.native-chat.composer.autonomyPermissionLowDescription',
          'Edits files and runs read-only commands; asks for the rest'
        )
      }
    case 'medium':
      return {
        label: translate('components.native-chat.composer.autonomyPermissionMedium', 'Medium'),
        description: translate(
          'components.native-chat.composer.autonomyPermissionMediumDescription',
          'Also runs reversible commands like installs, builds and local commits; asks for the rest'
        )
      }
    case 'high':
      return {
        label: translate('components.native-chat.composer.autonomyPermissionHigh', 'High'),
        description: translate(
          'components.native-chat.composer.autonomyPermissionHighDescription',
          'Runs commands without asking, except ones the agent blocks'
        )
      }
  }
}

export const NATIVE_CHAT_DROID_CHOICE_COPY: Readonly<Record<string, NativeChatDeclaredChoiceCopy>> =
  {
    [DROID_AUTONOMY_OPTION_ID]: droidPermissionChoiceCopy
  }
