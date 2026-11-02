import { DROID_COMPOSER_KEY_CHORDS, type DroidComposerKey } from './droid-composer-keys'
import { getNativeChatComposerKeyClaims } from './native-chat/native-chat-agent-profiles'

const ACTIONS: Record<DroidComposerKey, string> = {
  shiftTab: 'switch Spec mode on or off',
  ctrlL: 'cycle autonomy',
  tab: 'cycle reasoning effort',
  ctrlN: 'cycle through models',
  enter: 'send your message',
  ctrlEnter: 'send after the current reply',
  ctrlC: 'copy selected text, or stop the running reply once; never close the chat',
  escape: 'close a menu or clear the message; never stop a reply'
}

export function droidHelpKeyLines(platform: NodeJS.Platform): string[] {
  return [
    ...getNativeChatComposerKeyClaims('droid', platform).map(
      (key) => `${DROID_COMPOSER_KEY_CHORDS[key]}: ${ACTIONS[key]}.`
    ),
    'Escape three times on an empty message: confirm rewinding the latest turn.',
    ...(platform === 'win32' || platform === 'linux'
      ? ['Ctrl+L and Ctrl+N remain Orca shortcuts. Use the autonomy and model selectors instead.']
      : [])
  ]
}

/** List client platforms, not the execution host's OS: paired clients may differ. */
export function droidComposerKeyHelp(): string[] {
  return [
    'Message-box keys (mode keys wait while a reply runs):',
    'macOS:',
    ...droidHelpKeyLines('darwin'),
    'Windows/Linux:',
    ...droidHelpKeyLines('win32')
  ]
}
