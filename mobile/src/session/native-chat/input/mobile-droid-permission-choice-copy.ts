import { translate } from '../../../i18n/mobile-i18n'
import {
  DROID_AUTONOMY_OPTION_ID,
  isDroidAutonomyLevel
} from '../../../../../src/shared/droid-autonomy-options'
import type { MobileDeclaredChoiceCopy } from './mobile-native-chat-session-option-labels'

function droidPermissionChoiceCopy(value: string): ReturnType<MobileDeclaredChoiceCopy> {
  if (!isDroidAutonomyLevel(value)) {
    return undefined
  }
  switch (value) {
    case 'off':
      return {
        label: translate('chat.sessionOptionCopy.autonomyPermissionOff', 'Off'),
        description: translate(
          'chat.sessionOptionCopy.autonomyPermissionOffDescription',
          'Asks before edits and commands'
        )
      }
    case 'low':
      return {
        label: translate('chat.sessionOptionCopy.autonomyPermissionLow', 'Low'),
        description: translate(
          'chat.sessionOptionCopy.autonomyPermissionLowDescription',
          'Edits files and runs read-only commands; asks for the rest'
        )
      }
    case 'medium':
      return {
        label: translate('chat.sessionOptionCopy.autonomyPermissionMedium', 'Medium'),
        description: translate(
          'chat.sessionOptionCopy.autonomyPermissionMediumDescription',
          'Also runs reversible commands like installs, builds and local commits; asks for the rest'
        )
      }
    case 'high':
      return {
        label: translate('chat.sessionOptionCopy.autonomyPermissionHigh', 'High'),
        description: translate(
          'chat.sessionOptionCopy.autonomyPermissionHighDescription',
          'Runs commands without asking, except ones the agent blocks'
        )
      }
  }
}

export const MOBILE_DROID_CHOICE_COPY: Readonly<Record<string, MobileDeclaredChoiceCopy>> = {
  [DROID_AUTONOMY_OPTION_ID]: droidPermissionChoiceCopy
}
