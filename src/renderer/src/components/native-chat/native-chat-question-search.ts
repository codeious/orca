import type { AskOption } from '../../../../shared/native-chat-ask-types'

/** A substring match over what the row shows: its label and its secondary text. */
export function questionOptionMatchesSearch(option: AskOption, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase()
  return (
    needle === '' ||
    `${option.label}\n${option.description ?? ''}`.toLocaleLowerCase().includes(needle)
  )
}
