import { translate } from '@/i18n/i18n'
import {
  DROID_HOST_COMMAND_NAMES,
  type DroidHostCommandName
} from '../../../../shared/droid-command-registry'
import type { SlashCommandSuggestion } from '../../../../shared/native-chat-slash-commands'

// Typed by the registry's names, so a command registered there does not compile until it has words.
const DESCRIPTIONS: Record<DroidHostCommandName, () => string> = {
  help: () =>
    translate('components.native-chat.droidCommands.help', 'Show the Droid commands and keys')
}

export function droidCommandSuggestions(): readonly SlashCommandSuggestion[] {
  return DROID_HOST_COMMAND_NAMES.map((name) => ({ name, description: DESCRIPTIONS[name]() }))
}

export function droidCommandHelpLines(): string[] {
  return DROID_HOST_COMMAND_NAMES.map((name) =>
    translate('components.native-chat.droidHelp.commandLine', '/{{name}}: {{description}}.', {
      name,
      description: DESCRIPTIONS[name]()
    })
  )
}
