import type {
  ChatApproval,
  ChatApprovalNotes
} from '../../../../../src/shared/native-chat/input/native-chat-interactive-prompt'

export type MobileChatPermissionResponder = (
  send: string,
  notes?: ChatApprovalNotes
) => Promise<boolean>

export type MobileChatPermission = ChatApproval & {
  /** Structured prompt identity, present only when the host can cancel it exactly. */
  prompt?: { itemId: string; expectedRevision: number }
}
