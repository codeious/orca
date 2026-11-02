import { isPlanApprovalSubject } from './agent-session/agent-session-approval-subject'
import type {
  ChatApproval,
  ChatApprovalNotes
} from './native-chat/input/native-chat-interactive-prompt'

export function collectChatApprovalNotes(
  approval: ChatApproval,
  comment: string,
  editedPlan: string | null
): ChatApprovalNotes | undefined {
  const notes: ChatApprovalNotes = {}
  if (approval.acceptsComment && comment.trim()) {
    notes.comment = comment
  }
  if (
    approval.acceptsPlanEdit &&
    isPlanApprovalSubject(approval.subject) &&
    editedPlan !== null &&
    editedPlan !== approval.subject.text &&
    editedPlan.trim()
  ) {
    notes.editedSpecContent = editedPlan
  }
  return Object.keys(notes).length ? notes : undefined
}
