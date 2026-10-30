/** The session Droid made for an approved Spec plan, as the row that reports it carries it. */
export type AgentJournalSpecHandoff = {
  newSessionId: string
  /** The first message of the new session, as Droid wrote it. */
  initialPrompt: string
  specHandoffId: string
  /** The level the chosen option named; absent when it named none. */
  autonomyLevel?: string
}
