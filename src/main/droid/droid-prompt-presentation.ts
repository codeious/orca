import type {
  AgentJournalApprovalItem,
  AgentJournalQuestionItem,
  AgentJournalResolution
} from '../../shared/agent-session-journal-types'
import type { AgentSessionPromptResponse } from '../../shared/agent-session-question-answer'
import type { DroidSpecHandoffs } from './droid-spec-handoff'

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
  /** Where a handoff the person starts is recorded, to be matched with Droid's echo of it. */
  handoffs: DroidSpecHandoffs
}

/** A request Droid made of the person: the card that shows it and the answer a choice makes. */
export type DroidPromptPresentation = {
  body: AgentJournalApprovalItem | AgentJournalQuestionItem
  /** What Droid is answered with. Null is a dismissal, which Droid hears as its own refusal.
   *  Throws for a response the card did not offer. */
  reply: (response: AgentSessionPromptResponse | null) => unknown
  /** Set on a card that is one part of a longer request. Answering it opens the next card and Droid
   *  keeps waiting; only a dismissal still goes to `reply`. Throws for a response the card did not offer. */
  advance?: (response: AgentSessionPromptResponse) => DroidPromptPresentation
}
