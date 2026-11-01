import {
  agentJournalSubmissionKey,
  parseAgentJournalItemKey
} from './agent-session-journal-item-key'
import type { AgentJournalSubmission } from './agent-session-journal-types'

/**
 * The message id Droid knows a journal row by, or null when the row is not one Droid can rewind
 * to. A send Orca placed is followed to the row Droid accepted it as. An adopted row counts only
 * when its record id is Droid's own: a row known by its line number was never named by Droid.
 */
export function droidMessageIdOfJournalItem(
  itemId: string,
  submissions: readonly Pick<
    AgentJournalSubmission,
    'clientMessageId' | 'dispatchState' | 'providerItemId'
  >[]
): string | null {
  const accepted = submissions.find(
    (submission) =>
      submission.dispatchState === 'accepted' &&
      submission.providerItemId !== null &&
      agentJournalSubmissionKey(submission.clientMessageId) === itemId
  )
  const identity = parseAgentJournalItemKey(accepted?.providerItemId ?? itemId)
  if (identity?.provider === 'droid') {
    return identity.messageId
  }
  if (
    identity?.provider === 'legacy' &&
    identity.agent === 'droid' &&
    !identity.recordId.startsWith('#')
  ) {
    return identity.recordId
  }
  return null
}
