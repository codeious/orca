import type {
  AgentJournalApprovalItem,
  AgentJournalQuestionItem,
  AgentJournalResolution
} from '../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentSessionPromptResponse } from '../../shared/agent-session/agent-session-question-answer'
import type { DroidAutonomyLevel } from '../../shared/droid-autonomy-options'

export const pendingDroidResolution: AgentJournalResolution = {
  state: 'pending',
  selectedOptionId: null,
  resolvedBy: null,
  resolvedAt: null
}

/** What a presenter reads of the session besides the request itself. */
export type DroidPromptEnvironment = {
  /** The autonomy levels Droid has reported the session may run at; undefined until it has. */
  autonomyLevels: () => readonly string[] | undefined
  autonomyLevel: () => string | undefined
  beginSpecHandoff?: (option: string, operationId: string) => string
  planApproved?: (level: DroidAutonomyLevel | null) => void
}

/** A request Droid made of the person: the card that shows it and the answer a choice makes. */
export type DroidPromptPresentation = {
  body: AgentJournalApprovalItem | AgentJournalQuestionItem
  /** What Droid is answered with. Null is a dismissal, which Droid hears as its own refusal.
   *  Throws for a response the card did not offer. */
  reply: (response: AgentSessionPromptResponse | null, operationId?: string) => unknown
  /** Opens the next card, or returns null to answer now through `reply`. */
  advance?: (response: AgentSessionPromptResponse) => DroidPromptPresentation | null
  replied?: () => void
}
