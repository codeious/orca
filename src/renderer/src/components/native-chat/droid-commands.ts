import { translate } from '@/i18n/i18n'
import {
  DROID_HOST_COMMAND_NAMES,
  type DroidHostCommandName
} from '../../../../shared/droid-command-registry'
import type { SlashCommandSuggestion } from '../../../../shared/native-chat-slash-commands'

// Typed by the registry's names, so a command registered there does not compile until it has words.
const DESCRIPTIONS: Record<DroidHostCommandName, () => string> = {
  help: () =>
    translate('components.native-chat.droidCommands.help', 'Show the Droid commands and keys'),
  clear: () =>
    translate(
      'components.native-chat.droidCommands.clear',
      'Start a new session that keeps these settings'
    ),
  new: () =>
    translate(
      'components.native-chat.droidCommands.new',
      'Start a new session with the settings of a new chat'
    ),
  quit: () =>
    translate(
      'components.native-chat.droidCommands.quit',
      'Close this chat and keep it in Session History'
    ),
  exit: () =>
    translate(
      'components.native-chat.droidCommands.exit',
      'Close this chat and keep it in Session History'
    ),
  context: () =>
    translate('components.native-chat.droidCommands.context', 'Show how much context is in use'),
  cost: () =>
    translate(
      'components.native-chat.droidCommands.cost',
      'Show the Factory credits this session has used'
    ),
  compress: () =>
    translate(
      'components.native-chat.droidCommands.compress',
      'Summarize the conversation to free up context; add instructions to guide the summary'
    ),
  fork: () =>
    translate(
      'components.native-chat.droidCommands.fork',
      'Copy this conversation into a new session you can open in its own tab'
    ),
  rename: () =>
    translate(
      'components.native-chat.droidCommands.rename',
      'Give this chat the title you type after the command, in Orca and in Droid'
    ),
  'rewind-conversation': () =>
    translate(
      'components.native-chat.droidCommands.rewind-conversation',
      'Go back to before your latest message in a new session'
    )
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
