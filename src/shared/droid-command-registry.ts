/** Commands the host answers by asking the Droid child, which sends nothing as a message. */
export const DROID_CHILD_COMMAND_NAMES = [
  'context',
  'cost',
  'compress',
  'fork',
  'rename',
  'cwd',
  'cd',
  'skills',
  'mcp',
  'rewind-conversation'
] as const

/** The slash commands a Droid chat answers on the host, so their text never reaches the model. */
export const DROID_HOST_COMMAND_NAMES = [
  'help',
  'clear',
  'new',
  'quit',
  'exit',
  ...DROID_CHILD_COMMAND_NAMES
] as const

export type DroidHostCommandName = (typeof DROID_HOST_COMMAND_NAMES)[number]

export type DroidChildCommandName = (typeof DROID_CHILD_COMMAND_NAMES)[number]

export function isDroidHostCommandName(name: string): name is DroidHostCommandName {
  return DROID_HOST_COMMAND_NAMES.some((registered) => registered === name)
}

export function isDroidChildCommandName(name: string): name is DroidChildCommandName {
  return DROID_CHILD_COMMAND_NAMES.some((registered) => registered === name)
}
