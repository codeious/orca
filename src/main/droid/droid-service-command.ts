import { tokenizeStartupCommand } from '../../shared/agent-launch/startup/tui-agent-startup-shell'
import { DroidServiceCommandError } from './droid-service-command-error'
import { runDroidSkills, type DroidSkillsResult } from './droid-skills'
import type { DroidSession } from './droid-session'

function skillToggle(words: string[]): { skillName: string; disabled: boolean } | undefined {
  if (words.length === 0) {
    return undefined
  }
  const [action, name] = words
  if (
    words.length === 2 &&
    name &&
    name.length <= 200 &&
    (action === 'enable' || action === 'disable')
  ) {
    return { skillName: name, disabled: action === 'disable' }
  }
  throw new Error('Use /skills or /skills enable|disable NAME.')
}

function resultText({ skills }: DroidSkillsResult): string {
  return skills.length
    ? skills.map((skill) => `${skill.name}: ${skill.enabled ? 'enabled' : 'disabled'}`).join('\n')
    : 'Droid lists no skills.'
}

/** `/skills`: lists Droid's skills, or turns one on or off. */
export async function runDroidServiceCommand(
  session: Pick<DroidSession, 'request'>,
  input: { argument: string }
): Promise<string> {
  const parsed = tokenizeStartupCommand(input.argument, 'posix')
  if (!parsed.ok) {
    throw new Error('Command arguments have invalid quoting.')
  }
  const toggle = skillToggle(parsed.tokens)
  try {
    return resultText(await runDroidSkills(session, toggle)).slice(0, 32_000)
  } catch (error) {
    // Provider service errors can repeat an authentication URL.
    throw error instanceof DroidServiceCommandError
      ? error
      : new Error('Droid could not complete this service command.')
  }
}
