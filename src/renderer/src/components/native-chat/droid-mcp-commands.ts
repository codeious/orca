import { translate } from '@/i18n/i18n'
import {
  DROID_MCP_ARGS_MAX,
  DROID_MCP_ARG_MAX_LENGTH,
  DROID_MCP_NAME_MAX_LENGTH,
  DROID_MCP_TARGET_MAX_LENGTH,
  type DroidHostCommand,
  type DroidHostCommandResult,
  type DroidMcpAction,
  type DroidMcpChange,
  type DroidMcpServer
} from '../../../../shared/droid-host-command'

type McpResult = Extract<DroidHostCommandResult, { name: 'mcp' }>

/** Splits on spaces; a quote pair keeps what is inside it, spaces and all. Null when a quote is left open.
 *  Not `tokenizeCommandLine`: backslashes stay literal (Windows paths), an empty `""` is kept, and an open quote is refused. */
function wordsOf(text: string): string[] | null {
  const words: string[] = []
  let current = ''
  let inWord = false
  let quote: string | null = null
  for (const char of text) {
    if (quote !== null) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      quote = char
      inWord = true
    } else if (/\s/.test(char)) {
      if (inWord) {
        words.push(current)
        current = ''
        inWord = false
      }
    } else {
      current += char
      inWord = true
    }
  }
  if (quote !== null) {
    return null
  }
  if (inWord) {
    words.push(current)
  }
  return words
}

function isWebAddress(text: string): boolean {
  if (text.length > DROID_MCP_TARGET_MAX_LENGTH) {
    return false
  }
  try {
    const { protocol } = new URL(text)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

function addAction(words: string[]): DroidMcpAction | null {
  const [serverName, first, ...more] = words
  if (!serverName || serverName.length > DROID_MCP_NAME_MAX_LENGTH || !first) {
    return null
  }
  const kind = first.toLowerCase()
  if (kind === 'http' || kind === 'sse') {
    const [url, ...extra] = more
    return url !== undefined && extra.length === 0 && isWebAddress(url)
      ? { kind: 'add', serverName, server: { type: kind, url } }
      : null
  }
  const tooLong =
    first.length > DROID_MCP_TARGET_MAX_LENGTH ||
    more.length > DROID_MCP_ARGS_MAX ||
    more.some((argument) => argument.length > DROID_MCP_ARG_MAX_LENGTH)
  return tooLong
    ? null
    : { kind: 'add', serverName, server: { type: 'stdio', command: first, args: more } }
}

function namedAction(verb: string, words: string[]): DroidMcpAction | null {
  const [serverName, ...extra] = words
  if (!serverName || extra.length > 0 || serverName.length > DROID_MCP_NAME_MAX_LENGTH) {
    return null
  }
  switch (verb) {
    case 'enable':
      return { kind: 'toggle', serverName, enabled: true }
    case 'disable':
      return { kind: 'toggle', serverName, enabled: false }
    case 'remove':
      return { kind: 'remove', serverName }
    case 'signin':
    case 'sign-in':
      return { kind: 'sign-in', serverName }
    default:
      return null
  }
}

/** What follows `/mcp`: nothing or `list`, `add`, `enable`, `disable`, `remove` or `signin`; null for any other words. */
export function mcpHostCommand(argument: string): DroidHostCommand | null {
  const words = wordsOf(argument)
  if (words === null) {
    return null
  }
  const [verbWord = '', ...rest] = words
  const verb = verbWord.toLowerCase()
  let action: DroidMcpAction | null
  if (words.length === 0 || verb === 'list') {
    action = rest.length === 0 ? { kind: 'list' } : null
  } else if (verb === 'add') {
    action = addAction(rest)
  } else {
    action = namedAction(verb, rest)
  }
  return action ? { name: 'mcp', action } : null
}

export function mcpRefusal(argument: string): string | null {
  return mcpHostCommand(argument) === null
    ? translate(
        'components.native-chat.droidChildCommands.mcpUsage',
        'Use /mcp to list MCP servers, or /mcp add <name> <command> [arguments], /mcp add <name> http <address>, /mcp enable <name>, /mcp disable <name>, /mcp remove <name> or /mcp signin <name>.'
      )
    : null
}

function serverWords(server: DroidMcpServer): string {
  const details: string[] = server.type === null ? [] : [server.type]
  details.push(server.status)
  if (server.toolCount !== null) {
    details.push(
      server.toolCount === 1
        ? translate('components.native-chat.droidChildCommands.mcpToolOne', '1 tool')
        : translate('components.native-chat.droidChildCommands.mcpToolMany', '{{tools}} tools', {
            tools: String(server.toolCount)
          })
    )
  }
  if (server.needsSignIn) {
    details.push(
      translate('components.native-chat.droidChildCommands.mcpNeedsSignIn', 'needs sign-in')
    )
  }
  return translate(
    'components.native-chat.droidChildCommands.mcpServer',
    '{{name}} ({{details}})',
    {
      name: server.name,
      details: details.join(', ')
    }
  )
}

function changeWords({ kind, serverName: name }: DroidMcpChange): string {
  switch (kind) {
    case 'added':
      return translate(
        'components.native-chat.droidChildCommands.mcpAdded',
        'Added the {{name}} MCP server.',
        { name }
      )
    case 'enabled':
      return translate(
        'components.native-chat.droidChildCommands.mcpEnabled',
        'Turned on the {{name}} MCP server.',
        { name }
      )
    case 'disabled':
      return translate(
        'components.native-chat.droidChildCommands.mcpDisabled',
        'Turned off the {{name}} MCP server.',
        { name }
      )
    case 'removed':
      return translate(
        'components.native-chat.droidChildCommands.mcpRemoved',
        'Removed the {{name}} MCP server.',
        { name }
      )
    case 'signed-in':
      return translate(
        'components.native-chat.droidChildCommands.mcpSignedIn',
        'Signed in to the {{name}} MCP server.',
        { name }
      )
  }
}

/** One paragraph: the notice that shows it does not keep line breaks. An address is never in it. */
export function mcpWords({ servers, changed }: McpResult): string {
  const list =
    servers.length === 0
      ? null
      : translate(
          'components.native-chat.droidChildCommands.mcpServers',
          'MCP servers: {{servers}}.',
          {
            servers: servers.map(serverWords).join('; ')
          }
        )
  if (changed === null) {
    return list === null
      ? translate(
          'components.native-chat.droidChildCommands.mcpNone',
          'No MCP servers are set up. Add one with /mcp add <name> <command>.'
        )
      : `${list} ${translate(
          'components.native-chat.droidChildCommands.mcpHint',
          'Change one with /mcp add, /mcp remove, /mcp disable, /mcp enable or /mcp signin <name>.'
        )}`
  }
  return `${changeWords(changed)} ${
    list ??
    translate('components.native-chat.droidChildCommands.mcpNoneLeft', 'No MCP servers are left.')
  }`
}
