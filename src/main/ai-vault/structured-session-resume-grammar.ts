import { commandWordIndex, splitShellCommandSegments } from './shell-command-segments'

export type ResumeInvocation = {
  provider: string
  /** The session id the command names. Null when it may pick any session of the provider. */
  target: string | null
}

type ProviderResumeGrammar = {
  provider: string
  executable: RegExp
  /** Reads the arguments after the executable; null when they write no session already in use. */
  parse: (args: readonly string[]) => Pick<ResumeInvocation, 'target'> | null
}

function parseCodexResume(args: readonly string[]): Pick<ResumeInvocation, 'target'> | null {
  // `codex fork` falls through here: it carries no `resume` marker.
  const markerIndex = args.findIndex((token) => token.toLowerCase() === 'resume')
  if (markerIndex === -1) {
    return null
  }
  return { target: nextValue(args, markerIndex) }
}

function parseClaudeResume(args: readonly string[]): Pick<ResumeInvocation, 'target'> | null {
  if (isClaudeForkInvocation(args)) {
    return null
  }
  // `--continue`/`-c` resume the most recent session and never take an id, so a
  // following token is a prompt, not a target — they are always target-less.
  if (args.some((token) => ['--continue', '-c'].includes(token.toLowerCase()))) {
    return { target: null }
  }
  const inlineIndex = args.findIndex(
    (token) => token.toLowerCase().startsWith('--resume=') || token.toLowerCase().startsWith('-r=')
  )
  if (inlineIndex !== -1) {
    const target = args[inlineIndex]!.slice(args[inlineIndex]!.indexOf('=') + 1)
    return { target: target.length > 0 ? target : null }
  }
  const markerIndex = args.findIndex((token) => ['--resume', '-r'].includes(token.toLowerCase()))
  return markerIndex === -1 ? null : { target: nextValue(args, markerIndex) }
}

/** A fork reads the conversation and writes a new one, so it is no second writer. Not when
 *  `--session-id` names the id it writes under, and nothing after `--` is an option. */
function isClaudeForkInvocation(args: readonly string[]): boolean {
  const terminatorIndex = args.indexOf('--')
  const options = (terminatorIndex === -1 ? args : args.slice(0, terminatorIndex)).map((token) =>
    token.toLowerCase()
  )
  return (
    options.includes('--fork-session') &&
    !options.some((token) => token === '--session-id' || token.startsWith('--session-id='))
  )
}

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
// A session link or free text cannot be compared with an owned id, so it names no session.
const DROID_SESSION_ID = /^[A-Za-z0-9_-]+$/

function parseDroidInvocation(args: readonly string[]): Pick<ResumeInvocation, 'target'> | null {
  const terminatorIndex = args.indexOf('--')
  const options = terminatorIndex === -1 ? args : args.slice(0, terminatorIndex)
  // Droid refuses `exec --session-id` with `--fork`, so a fork never writes the session it reads.
  if (options.some((token) => token === '--fork' || token.startsWith('--fork='))) {
    return null
  }
  const subcommand = options.find((token) => DROID_SUBCOMMANDS.has(token))
  if (subcommand === 'exec') {
    return parseDroidExec(options)
  }
  if (subcommand === 'resume') {
    return parseDroidResumeSubcommand(args, options)
  }
  if (subcommand !== undefined) {
    return null
  }
  return parseDroidRoot(options)
}

function parseDroidRoot(options: readonly string[]): Pick<ResumeInvocation, 'target'> | null {
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

function parseDroidExec(options: readonly string[]): Pick<ResumeInvocation, 'target'> | null {
  const inline = options.find((token) => token.startsWith('--session-id='))
  if (inline) {
    return { target: droidTarget(inline.slice(inline.indexOf('=') + 1)) }
  }
  const markerIndex = options.findIndex((token) => token === '-s' || token === '--session-id')
  return markerIndex === -1 ? null : { target: droidTarget(nextValue(options, markerIndex)) }
}

function parseDroidResumeSubcommand(
  args: readonly string[],
  options: readonly string[]
): Pick<ResumeInvocation, 'target'> {
  if (options.includes('--last')) {
    return { target: null }
  }
  for (let index = options.indexOf('resume') + 1; index < options.length; index++) {
    const token = options[index]!
    if (DROID_VALUE_OPTIONS.has(token)) {
      index++
    } else if (DROID_OPTIONAL_VALUE_OPTIONS.has(token)) {
      if (options[index + 1] !== undefined && !options[index + 1]!.startsWith('-')) {
        index++
      }
    } else if (!token.startsWith('-')) {
      return { target: droidTarget(token) }
    }
  }
  // Everything after `--` is an argument, so the first of them is the session.
  return { target: droidTarget(args[options.length + 1] ?? null) }
}

function droidTarget(value: string | null): string | null {
  return value !== null && DROID_SESSION_ID.test(value) ? value : null
}

function nextValue(args: readonly string[], flagIndex: number): string | null {
  const candidate = args[flagIndex + 1]
  return candidate && !candidate.startsWith('-') ? candidate : null
}

const GRAMMARS: readonly ProviderResumeGrammar[] = [
  { provider: 'codex', executable: /(?:^|[\\/])codex(?:\.exe)?$/i, parse: parseCodexResume },
  { provider: 'claude', executable: /(?:^|[\\/])claude(?:\.exe)?$/i, parse: parseClaudeResume },
  { provider: 'droid', executable: /(?:^|[\\/])droid(?:\.exe)?$/i, parse: parseDroidInvocation }
]

/** Whether a native chat of this agent can own sessions the vault lists, and so be guarded. */
export function hasStructuredResumeGrammar(agent: string): boolean {
  return GRAMMARS.some((grammar) => grammar.provider === agent)
}

export function parseResumeInvocation(command: string): ResumeInvocation | null {
  // Keep this deliberately conservative: shell quoting is normalized only
  // enough to identify executable/flag tokens; an unrecognized shape is not
  // treated as proof that a different session is being resumed.
  for (const words of splitShellCommandSegments(command)) {
    const index = commandWordIndex(words)
    const grammar =
      index === -1
        ? undefined
        : GRAMMARS.find((candidate) => candidate.executable.test(words[index]!))
    const parsed = grammar?.parse(words.slice(index + 1))
    if (grammar && parsed) {
      return { provider: grammar.provider, ...parsed }
    }
  }
  return null
}
