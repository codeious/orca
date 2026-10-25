import type {
  AgentJournalApprovalItem,
  AgentJournalQuestionItem,
  AgentJournalResolution
} from '../../shared/agent-session-journal-types'
import type { AgentSessionPromptResponse } from '../../shared/agent-session-question-answer'

export const pendingDroidResolution: AgentJournalResolution = {
  state: 'pending',
  selectedOptionId: null,
  resolvedBy: null,
  resolvedAt: null
}

/** A request Droid made of the person: the card that shows it and the answer a choice makes. */
export type DroidPromptPresentation = {
  body: AgentJournalApprovalItem | AgentJournalQuestionItem
  /** What Droid is answered with. Null is a dismissal, which Droid hears as its own refusal.
   *  Throws for a response the card did not offer. */
  reply: (response: AgentSessionPromptResponse | null) => unknown
}
