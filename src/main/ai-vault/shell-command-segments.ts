// Characters that end a simple command outside quotes. `&` is also a redirect (`2>&1`, `&>f`).
const COMMAND_SEPARATORS = new Set([';', '|', '&', '(', ')', '`', '\n'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

// Prefixes that run the next word as the command, with the options that take a value.
const COMMAND_PREFIXES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['env', new Set(['-u', '--unset', '-C', '--chdir'])],
  ['exec', new Set(['-a'])],
  ['command', new Set<string>()],
  ['nohup', new Set<string>()],
  ['time', new Set<string>()],
  ['setsid', new Set<string>()],
  ['nice', new Set(['-n', '--adjustment'])],
  ['sudo', new Set(['-u', '--user', '-g', '--group', '-p', '--prompt'])],
  ['doas', new Set(['-u'])]
])

/** The words of each simple command in a shell line, quotes removed; `cd x && agent y` is two. */
export function splitShellCommandSegments(command: string): string[][] {
  const segments: string[][] = []
  let words: string[] = []
  let word: string | null = null
  const endWord = (): void => {
    if (word !== null) {
      words.push(word)
      word = null
    }
  }
  const endSegment = (): void => {
    endWord()
    if (words.length > 0) {
      segments.push(words)
      words = []
    }
  }

  let index = 0
  while (index < command.length) {
    const char = command[index]!
    if (char === "'" || char === '"') {
      const end = quoteEnd(command, index)
      if (end !== -1) {
        word = (word ?? '') + command.slice(index + 1, end - 1)
        index = end
        continue
      }
    } else if (/\s/.test(char) && char !== '\n') {
      endWord()
      index++
      continue
    } else if (COMMAND_SEPARATORS.has(char) && !isRedirectAmpersand(command, index)) {
      endSegment()
      index++
      continue
    }
    word = (word ?? '') + char
    index++
  }
  endSegment()
  return segments
}

/** The word a simple command runs, past variable assignments and prefixes like `env -u X`; -1 if none. */
export function commandWordIndex(words: readonly string[]): number {
  let index = 0
  while (index < words.length) {
    const word = words[index]!
    if (ASSIGNMENT.test(word)) {
      index++
      continue
    }
    const valueOptions = COMMAND_PREFIXES.get(word.split(/[\\/]/).at(-1)!.toLowerCase())
    if (!valueOptions) {
      return index
    }
    index++
    while (index < words.length && words[index]!.startsWith('-')) {
      index += valueOptions.has(words[index]!) ? 2 : 1
    }
  }
  return -1
}

function quoteEnd(command: string, start: number): number {
  if (command[start] === "'") {
    const end = command.indexOf("'", start + 1)
    return end === -1 ? -1 : end + 1
  }
  for (let index = start + 1; index < command.length; index++) {
    if (command[index] === '\\') {
      index++
    } else if (command[index] === '"') {
      return index + 1
    }
  }
  // cmd and PowerShell paths end in a backslash: `cd /d "C:\"`.
  const plain = command.indexOf('"', start + 1)
  return plain === -1 ? -1 : plain + 1
}

function isRedirectAmpersand(command: string, index: number): boolean {
  return (
    command[index] === '&' &&
    (command[index - 1] === '>' || command[index - 1] === '<' || command[index + 1] === '>')
  )
}
