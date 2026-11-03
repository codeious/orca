import { translate } from '../../../i18n/mobile-i18n'
import type { SessionOptionDescriptor } from '../../../../../src/shared/native-chat/input/native-chat-session-options'
import {
  nativeChatSessionChoiceLabel,
  selectedNativeChatChoice
} from '../../../../../src/shared/native-chat/input/native-chat-session-option-labels'
import { sayMobileNativeChatSessionOption as say } from './native-chat-session-option-copy'
import {
  DROID_AUTONOMY_OPTION_ID,
  isDroidAutonomyLevel,
  type DroidAutonomyLevel
} from '../../../../../src/shared/droid-autonomy-options'

/** The value a drill-in row shows beside its label; desktop lists the choices in place instead. */
export function mobileSessionOptionSummaryValue(descriptor: SessionOptionDescriptor): string {
  // Show the boolean value consistently with its switch; the source marker separately expresses whether it is confirmed.
  if (descriptor.kind.type === 'boolean') {
    return descriptor.kind.currentValue
      ? translate('chat.sessionOptionCopy.on', 'On')
      : translate('chat.sessionOptionCopy.off', 'Off')
  }
  if (descriptor.valueSource === 'unknown') {
    return descriptor.id === 'permissionMode'
      ? translate('chat.sessionOptionCopy.permissions', 'Permissions')
      : translate('chat.sessionOptionCopy.notSet', 'Not set')
  }
  if (
    descriptor.id === 'permissionMode' &&
    descriptor.kind.type === 'select' &&
    descriptor.kind.currentValue === 'own'
  ) {
    return translate('settings.agents.permissionOwnAll', "Agents' own settings")
  }
  const choice = selectedNativeChatChoice(descriptor)
  if (!choice) {
    return translate('chat.sessionOptionCopy.notSet', 'Not set')
  }
  if (descriptor.id === 'permissionMode' && descriptor.description) {
    return descriptor.description
  }
  if (descriptor.id === DROID_AUTONOMY_OPTION_ID && isDroidAutonomyLevel(choice.value)) {
    return mobileDroidPermissionLabel(choice.value)
  }
  return nativeChatSessionChoiceLabel(choice, say, descriptor.id)
}

export function mobileDroidPermissionLabel(level: DroidAutonomyLevel): string {
  switch (level) {
    case 'off':
      return translate('chat.sessionOptionCopy.droidPermissionOff', 'Off')
    case 'low':
      return translate('chat.sessionOptionCopy.droidPermissionLow', 'Low')
    case 'medium':
      return translate('chat.sessionOptionCopy.droidPermissionMedium', 'Medium')
    case 'high':
      return translate('chat.sessionOptionCopy.droidPermissionHigh', 'High')
  }
}

export function mobileDroidPermissionDescription(level: DroidAutonomyLevel): string {
  switch (level) {
    case 'off':
      return translate(
        'chat.sessionOptionCopy.droidPermissionOffDescription',
        'Asks before edits and commands'
      )
    case 'low':
      return translate(
        'chat.sessionOptionCopy.droidPermissionLowDescription',
        'Edits files and runs read-only commands; asks for the rest'
      )
    case 'medium':
      return translate(
        'chat.sessionOptionCopy.droidPermissionMediumDescription',
        'Also runs reversible commands like installs, builds and local commits; asks for the rest'
      )
    case 'high':
      return translate(
        'chat.sessionOptionCopy.droidPermissionHighDescription',
        'Runs commands without asking, except ones Droid blocks'
      )
  }
}
