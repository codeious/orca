// Canonical AskUserQuestion prompt types consumed by the shared parser and both
// native-chat platform UIs.

export type AskOption = { label: string; description?: string }
export type AskQuestion = {
  question: string
  header?: string
  /** A note under the question. */
  description?: string
  multiSelect: boolean
  options: AskOption[]
  /** Option indices chosen when the card opens. */
  preselected?: number[]
  /** Present when the options can be searched; the search starts with this text. */
  initialSearch?: string
}
export type AskPrompt = { questions: AskQuestion[] }

/** A parser turns one agent's interactive-question tool input into the normalized
 *  AskPrompt the card renders. */
export type InteractiveQuestionParser = (input: unknown) => AskPrompt | null
