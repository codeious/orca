/** The slash commands a Droid chat answers on the host, so their text never reaches the model. */
export const DROID_HOST_COMMAND_NAMES = ['help', 'clear', 'new', 'quit', 'exit'] as const

export type DroidHostCommandName = (typeof DROID_HOST_COMMAND_NAMES)[number]

export function isDroidHostCommandName(name: string): name is DroidHostCommandName {
  return DROID_HOST_COMMAND_NAMES.some((registered) => registered === name)
}
