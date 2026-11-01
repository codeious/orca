/** What a provider adds to a question that is a pick from a list. */
export type AgentJournalQuestionPicker = {
  /** A note under the question, such as how to recover from an empty list. */
  description?: string
  /** Options already chosen when the card opens. */
  preselectedOptionIds?: string[]
  /** Present when the options can be searched; the search starts with this text. */
  initialSearch?: string
}
