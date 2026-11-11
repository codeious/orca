import { isDroidSessionId } from './droid-session-id'
import type { StructuredAgentResumeInvocation } from '../native-chat/structured-agent-cli-conversations'

// Droid, read from `droid --help`, `droid resume --help`, and `droid exec --help` on 0.238.0 and
// 0.249.0. Inside `exec`, `-r` is the reasoning effort, so only the root command reads it as resume.
const DROID_SUBCOMMANDS = new Set([
  'resume',
  'exec',
  'daemon',
  'search',
  'find',
  'update',
  'mcp',
  'plugin',
  'computer',
  'doctor',
  'help'
])
const DROID_VALUE_OPTIONS = new Set([
  '--settings',
  '--append-system-prompt',
  '--append-system-prompt-file',
  '--cwd',
  '--worktree-dir',
  '--auto'
])
const DROID_OPTIONAL_VALUE_OPTIONS = new Set(['-w', '--worktree'])

export function parseDroidResumeArgs(
  args: readonly string[]
): StructuredAgentResumeInvocation | null {
  const terminatorIndex = args.indexOf('--')
  const options = terminatorIndex === -1 ? args : args.slice(0, terminatorIndex)
  const subcommandIndex = droidSubcommandIndex(options)
  if (subcommandIndex === -1) {
    return parseDroidRoot(options)
  }
  const subcommand = options[subcommandIndex]
  if (subcommand === 'exec') {
    return parseDroidExec(options.slice(subcommandIndex + 1))
  }
  if (subcommand === 'resume') {
    return parseDroidResumeSubcommand(args, options, subcommandIndex)
  }
  return null
}

/** Only the first operand can name a subcommand; anything after it is that command's own arguments. */
function droidSubcommandIndex(options: readonly string[]): number {
  for (let index = 0; index < options.length; index++) {
    const token = options[index]!
    if (takesDroidOptionValue(options, index)) {
      index++
    } else if (!token.startsWith('-')) {
      return DROID_SUBCOMMANDS.has(token) ? index : -1
    }
  }
  return -1
}

function isDroidForkOption(token: string): boolean {
  return token === '--fork' || token.startsWith('--fork=')
}

function takesDroidOptionValue(options: readonly string[], index: number): boolean {
  const token = options[index]!
  if (DROID_VALUE_OPTIONS.has(token)) {
    return true
  }
  const next = options[index + 1]
  return DROID_OPTIONAL_VALUE_OPTIONS.has(token) && next !== undefined && !next.startsWith('-')
}

function parseDroidRoot(options: readonly string[]): StructuredAgentResumeInvocation | null {
  // A root-command fork reads one conversation and writes another.
  if (options.some(isDroidForkOption)) {
    return null
  }
  if (options.includes('--last')) {
    return { target: null }
  }
  const inline = options.find((token) => token.startsWith('--resume='))
  if (inline) {
    return { target: droidTarget(inline.slice(inline.indexOf('=') + 1)) }
  }
  const attached = options.find((token) => /^-r[^-]/.test(token))
  if (attached) {
    return { target: droidTarget(attached.slice(2).replace(/^=/, '')) }
  }
  const markerIndex = options.findIndex((token) => token === '-r' || token === '--resume')
  return markerIndex === -1 ? null : { target: droidTarget(nextValue(options, markerIndex)) }
}

function parseDroidExec(options: readonly string[]): StructuredAgentResumeInvocation | null {
  const inline = options.find((token) => token.startsWith('--session-id='))
  if (inline) {
    return { target: droidTarget(inline.slice(inline.indexOf('=') + 1)) }
  }
  const markerIndex = options.findIndex((token) => token === '-s' || token === '--session-id')
  return markerIndex === -1 ? null : { target: droidTarget(nextValue(options, markerIndex)) }
}

function parseDroidResumeSubcommand(
  args: readonly string[],
  options: readonly string[],
  subcommandIndex: number
): StructuredAgentResumeInvocation | null {
  const own = options.slice(subcommandIndex + 1)
  if (own.some(isDroidForkOption)) {
    return null
  }
  if (own.includes('--last')) {
    return { target: null }
  }
  for (let index = 0; index < own.length; index++) {
    if (takesDroidOptionValue(own, index)) {
      index++
    } else if (!own[index]!.startsWith('-')) {
      return { target: droidTarget(own[index]!) }
    }
  }
  // Everything after `--` is an argument, so the first of them is the session.
  return { target: droidTarget(args[options.length + 1] ?? null) }
}

function droidTarget(value: string | null): string | null {
  return value !== null && isDroidSessionId(value) ? value : null
}

function nextValue(args: readonly string[], flagIndex: number): string | null {
  const candidate = args[flagIndex + 1]
  return candidate && !candidate.startsWith('-') ? candidate : null
}
