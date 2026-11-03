import { translate } from '@/i18n/i18n'
import type { DroidAutonomyLevel } from '../../../../shared/droid-autonomy-options'

export function nativeChatDroidPermissionLabel(level: DroidAutonomyLevel): string {
  switch (level) {
    case 'off':
      return translate('components.native-chat.composer.droidPermissionOff', 'Off')
    case 'low':
      return translate('components.native-chat.composer.droidPermissionLow', 'Low')
    case 'medium':
      return translate('components.native-chat.composer.droidPermissionMedium', 'Medium')
    case 'high':
      return translate('components.native-chat.composer.droidPermissionHigh', 'High')
  }
}

export function nativeChatDroidPermissionDescription(level: DroidAutonomyLevel): string {
  switch (level) {
    case 'off':
      return translate(
        'components.native-chat.composer.droidPermissionOffDescription',
        'Asks before edits and commands'
      )
    case 'low':
      return translate(
        'components.native-chat.composer.droidPermissionLowDescription',
        'Edits files and runs read-only commands; asks for the rest'
      )
    case 'medium':
      return translate(
        'components.native-chat.composer.droidPermissionMediumDescription',
        'Also runs reversible commands like installs, builds and local commits; asks for the rest'
      )
    case 'high':
      return translate(
        'components.native-chat.composer.droidPermissionHighDescription',
        'Runs commands without asking, except ones Droid blocks'
      )
  }
}
