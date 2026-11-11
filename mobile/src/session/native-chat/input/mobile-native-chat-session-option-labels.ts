import { translate } from '../../../i18n/mobile-i18n'
import type { SessionOptionDescriptor } from '../../../../../src/shared/native-chat/input/native-chat-session-options'
import {
  nativeChatSessionChoiceLabel,
  selectedNativeChatChoice
} from '../../../../../src/shared/native-chat/input/native-chat-session-option-labels'
import { sayMobileNativeChatSessionOption as say } from './native-chat-session-option-copy'
import { MOBILE_DROID_CHOICE_COPY } from './mobile-droid-permission-choice-copy'

export type MobileDeclaredChoiceCopy = (
  value: string
) => { label: string; description: string } | undefined

// Providers translate the choices they declare; other choices keep the host's own words.
const DECLARED_CHOICE_COPY: Readonly<Record<string, MobileDeclaredChoiceCopy>> = {
  ...MOBILE_DROID_CHOICE_COPY
}

export function mobileDeclaredChoiceCopy(
  optionId: string,
  value: string
): ReturnType<MobileDeclaredChoiceCopy> {
  return Object.hasOwn(DECLARED_CHOICE_COPY, optionId)
    ? DECLARED_CHOICE_COPY[optionId]?.(value)
    : undefined
}

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
  return (
    mobileDeclaredChoiceCopy(descriptor.id, choice.value)?.label ??
    nativeChatSessionChoiceLabel(choice, say, descriptor.id)
  )
}
