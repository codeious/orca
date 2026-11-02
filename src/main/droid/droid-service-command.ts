import { tokenizeStartupCommand } from '../../shared/tui-agent-startup-shell'
import { parseExternalHttpUrl } from '../ipc/external-http-url'
import { DroidServiceCommandError } from './droid-service-command-error'
import type { DroidMcpAction, DroidServiceCommandResult } from './droid-service-command-types'
import { runDroidMcp } from './droid-mcp'
import { runDroidSkills } from './droid-skills'
import type { DroidSession } from './droid-session'

function mcpAction(words: string[]): DroidMcpAction {
  const [action, name, type, target, ...args] = words
  if (words.length === 0) {
    return { kind: 'list' }
  }
  if (name && name.length <= 200 && words.length === 2) {
    if (action === 'sign-in' || action === 'remove') {
      return action === 'sign-in'
        ? { kind: 'sign-in', serverName: name }
        : { kind: 'remove', serverName: name }
    }
    if (action === 'enable' || action === 'disable') {
      return { kind: 'toggle', serverName: name, enabled: action === 'enable' }
    }
  }
  if (action === 'add' && name && name.length <= 200 && target && target.length <= 4096) {
    if (type === 'stdio' && args.length <= 64 && args.every((arg) => arg.length <= 4096)) {
      return { kind: 'add', serverName: name, server: { type, command: target, args } }
    }
    const url = parseExternalHttpUrl(target)
    if ((type === 'http' || type === 'sse') && url && args.length === 0) {
      return { kind: 'add', serverName: name, server: { type, url: url.toString() } }
    }
  }
  throw new Error(
    'Use /mcp, /mcp sign-in|enable|disable|remove NAME, or /mcp add NAME http|sse|stdio TARGET [ARGS].'
  )
}

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

function resultText(result: DroidServiceCommandResult): string {
  if (result.name === 'skills') {
    return result.skills.length
      ? result.skills
          .map((skill) => `${skill.name}: ${skill.enabled ? 'enabled' : 'disabled'}`)
          .join('\n')
      : 'Droid lists no skills.'
  }
  const change = result.changed ? `${result.changed.serverName}: ${result.changed.kind}\n` : ''
  return (
    change +
    (result.servers.length
      ? result.servers
          .map(
            (server) =>
              `${server.name}: ${server.status}${server.needsSignIn ? ' (sign-in required)' : ''}`
          )
          .join('\n')
      : 'Droid lists no MCP servers.')
  )
}

export async function runDroidServiceCommand(
  session: Pick<DroidSession, 'request' | 'mcpSignIn'>,
  input: {
    name: string
    argument: string
    openMcpSignIn?: (url: string) => boolean | Promise<boolean>
  }
): Promise<string> {
  const parsed = tokenizeStartupCommand(input.argument, 'posix')
  if (!parsed.ok) {
    throw new Error('Command arguments have invalid quoting.')
  }
  const action = input.name === 'mcp' ? mcpAction(parsed.tokens) : undefined
  const toggle = input.name === 'skills' ? skillToggle(parsed.tokens) : undefined
  try {
    return resultText(
      action
        ? await runDroidMcp(session, action, input.openMcpSignIn)
        : await runDroidSkills(session, toggle)
    ).slice(0, 32_000)
  } catch (error) {
    // Provider service errors can repeat an authentication URL.
    throw error instanceof DroidServiceCommandError
      ? error
      : new Error('Droid could not complete this service command.')
  }
}
