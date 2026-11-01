import { translate } from '@/i18n/i18n'
import {
  DROID_SKILL_NAME_MAX_LENGTH,
  DROID_WORKING_FOLDER_MAX_LENGTH,
  type DroidHostCommand,
  type DroidHostCommandResult
} from '../../../../shared/droid-host-command'

/** `/cwd` and `/cd` are one command: the folder is whatever follows, spaces and all. */
export function cwdHostCommand(argument: string): DroidHostCommand {
  return { name: 'cwd', path: argument.trim() }
}

export function cwdRefusal(name: 'cwd' | 'cd', argument: string): string | null {
  const folder = argument.trim()
  if (folder === '') {
    return translate(
      'components.native-chat.droidChildCommands.cwdUsage',
      'Use /{{name}} followed by a folder inside this workspace, for example /{{name}} packages/app.',
      { name }
    )
  }
  return folder.length > DROID_WORKING_FOLDER_MAX_LENGTH
    ? translate(
        'components.native-chat.droidChildCommands.cwdTooLong',
        'Keep the /{{name}} folder under {{max}} characters.',
        { name, max: String(DROID_WORKING_FOLDER_MAX_LENGTH) }
      )
    : null
}

export function cwdWords(resolvedPath: string): string {
  return translate(
    'components.native-chat.droidChildCommands.cwdChanged',
    'Working folder is now {{path}}.',
    { path: resolvedPath }
  )
}

/** `/skills`, `/skills list`, `/skills disable <name>` or `/skills enable <name>`; null for any other words. */
export function skillsHostCommand(argument: string): DroidHostCommand | null {
  const [verb = '', skillName, ...extra] = argument.trim().split(/\s+/)
  const word = verb.toLowerCase()
  if (skillName === undefined) {
    return word === '' || word === 'list' ? { name: 'skills' } : null
  }
  const known = word === 'enable' || word === 'disable'
  if (!known || extra.length > 0 || skillName.length > DROID_SKILL_NAME_MAX_LENGTH) {
    return null
  }
  return { name: 'skills', toggle: { skillName, disabled: word === 'disable' } }
}

export function skillsRefusal(argument: string): string | null {
  return skillsHostCommand(argument) === null
    ? translate(
        'components.native-chat.droidChildCommands.skillsUsage',
        'Use /skills to list skills, /skills disable <name> to turn one off, or /skills enable <name> to turn one on.'
      )
    : null
}

/** One paragraph: the notice that shows it does not keep line breaks. */
export function skillsWords(result: Extract<DroidHostCommandResult, { name: 'skills' }>): string {
  const on = result.skills.filter((skill) => skill.enabled).map((skill) => skill.name)
  const off = result.skills.filter((skill) => !skill.enabled).map((skill) => skill.name)
  const counts = { on: String(on.length), total: String(result.skills.length) }
  if (result.changed) {
    const name = result.changed.skillName
    return result.changed.disabled
      ? translate(
          'components.native-chat.droidChildCommands.skillsTurnedOff',
          'Turned off the {{name}} skill. {{on}} of {{total}} skills are on.',
          { name, ...counts }
        )
      : translate(
          'components.native-chat.droidChildCommands.skillsTurnedOn',
          'Turned on the {{name}} skill. {{on}} of {{total}} skills are on.',
          { name, ...counts }
        )
  }
  if (result.skills.length === 0) {
    return translate(
      'components.native-chat.droidChildCommands.skillsNone',
      'Droid reports no skills.'
    )
  }
  const sentences = [
    translate(
      'components.native-chat.droidChildCommands.skillsSummary',
      'Skills: {{on}} on, {{off}} off.',
      { on: counts.on, off: String(off.length) }
    )
  ]
  if (on.length > 0) {
    sentences.push(
      translate('components.native-chat.droidChildCommands.skillsOn', 'On: {{names}}.', {
        names: on.join(', ')
      })
    )
  }
  if (off.length > 0) {
    sentences.push(
      translate('components.native-chat.droidChildCommands.skillsOff', 'Off: {{names}}.', {
        names: off.join(', ')
      })
    )
  }
  sentences.push(
    translate(
      'components.native-chat.droidChildCommands.skillsHint',
      'Turn one off or on with /skills disable <name> or /skills enable <name>.'
    )
  )
  return sentences.join(' ')
}
