import { translate } from '@/i18n/i18n'
import {
  isDroidHostCommandName,
  type DroidHostCommandName
} from '../../../../shared/droid-command-registry'
import { droidCommandHelpLines } from './droid-commands'

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
    translate('components.native-chat.droidHelp.ctrlN', 'Ctrl+N: cycle through models.'),
    translate(
      'components.native-chat.droidHelp.enter',
      'Enter: send your message. While Droid works, it steers the reply.'
    ),
    translate(
      'components.native-chat.droidHelp.ctrlEnter',
      'Ctrl+Enter: send your message. While Droid works, wait: Droid answers after its current reply.'
    ),
    translate(
      'components.native-chat.droidHelp.ctrlC',
      'Ctrl+C: copies the selected text; with none selected, it stops the running reply once. It never closes the chat, ends the Droid session or quits Orca.'
    ),
    translate(
      'components.native-chat.droidHelp.escape',
      'Esc: close an open menu or card, or clear the message. It never stops a reply.'
    ),
    translate(
      'components.native-chat.droidHelp.escapeThree',
      'Esc three times: open rewind when the message box is empty.'
    )
  ]
}

/** One paragraph: the notice that shows it does not keep line breaks. */
export function droidHelpText(): string {
  return [
    translate('components.native-chat.droidHelp.commandsIntro', 'Droid commands:'),
    ...droidCommandHelpLines(),
    translate('components.native-chat.droidHelp.keysIntro', 'Droid keys in the message box:'),
    ...droidHelpKeyLines()
  ].join(' ')
}

const ANSWERS: Partial<Record<DroidHostCommandName, () => string>> = { help: droidHelpText }

/** The host's own answers to commands it claims for Droid; null leaves the command's refusal. */
export function answerDroidHostCommand(name: string): string | null {
  const answer = isDroidHostCommandName(name) ? ANSWERS[name] : undefined
  return answer ? answer() : null
}
