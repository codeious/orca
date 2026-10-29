import { translate } from '@/i18n/i18n'

/** Droid's key bindings, each led by its chord. Droid reads the Control key on every OS, Mac
 *  included, so the chords carry `Ctrl+` everywhere. */
export function droidHelpKeyLines(): string[] {
  return [
    translate(
      'components.native-chat.droidHelp.shiftTab',
      'Shift+Tab: switch Spec mode on or off.'
    ),
    translate('components.native-chat.droidHelp.ctrlL', 'Ctrl+L: cycle autonomy.'),
    translate('components.native-chat.droidHelp.tab', 'Tab: cycle reasoning effort.'),
    translate('components.native-chat.droidHelp.ctrlN', 'Ctrl+N: cycle through models.')
  ]
}

/** One paragraph: the notice that shows it does not keep line breaks. */
export function droidHelpText(): string {
  return [
    translate('components.native-chat.droidHelp.keysIntro', 'Droid keys in the message box:'),
    ...droidHelpKeyLines()
  ].join(' ')
}

/** The host's own answers to commands it claims for Droid; null leaves the command's refusal. */
export function answerDroidHostCommand(name: string): string | null {
  return name === 'help' ? droidHelpText() : null
}
