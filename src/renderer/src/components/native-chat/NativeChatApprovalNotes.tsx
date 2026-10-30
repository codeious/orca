import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { isPlanApprovalSubject } from '../../../../shared/agent-session-approval-subject'
import type { ChatApproval, ChatApprovalNotes } from './native-chat-interactive-prompt'

export type NativeChatApprovalNotesState = {
  canComment: boolean
  canEditPlan: boolean
  comment: string
  setComment: (text: string) => void
  /** The plan as the person is editing it; null while they are not. */
  editedPlan: string | null
  setEditedPlan: (text: string | null) => void
  startEditing: () => void
  /** What goes with the chosen option, or undefined when nothing was typed or changed. */
  collect: () => ChatApprovalNotes | undefined
}

/** A comment and an edited plan ride with whichever option is chosen, and only on a card that takes them. */
export function useNativeChatApprovalNotes(approval: ChatApproval): NativeChatApprovalNotesState {
  const planText = isPlanApprovalSubject(approval.subject) ? approval.subject.text : null
  const [comment, setComment] = useState('')
  const [editedPlan, setEditedPlan] = useState<string | null>(null)
  const canComment = approval.acceptsComment === true
  const canEditPlan = approval.acceptsPlanEdit === true && planText !== null
  return {
    canComment,
    canEditPlan,
    comment,
    setComment,
    editedPlan,
    setEditedPlan,
    startEditing: () => setEditedPlan(planText ?? ''),
    collect: () => {
      const notes: ChatApprovalNotes = {}
      if (canComment && comment.trim() !== '') {
        notes.comment = comment
      }
      if (
        canEditPlan &&
        editedPlan !== null &&
        editedPlan !== planText &&
        editedPlan.trim() !== ''
      ) {
        notes.editedSpecContent = editedPlan
      }
      return Object.keys(notes).length > 0 ? notes : undefined
    }
  }
}

export function NativeChatApprovalPlanEditor({
  notes,
  disabled
}: {
  notes: NativeChatApprovalNotesState
  disabled: boolean
}): React.JSX.Element | null {
  if (notes.editedPlan === null) {
    return null
  }
  return (
    <div data-native-chat-approval-plan-editor="true" className="space-y-1.5">
      <Textarea
        variant="code"
        value={notes.editedPlan}
        disabled={disabled}
        aria-label={translate('components.native-chat.approval.plan.editLabel', 'Edited plan')}
        onChange={(event) => notes.setEditedPlan(event.target.value)}
        className="min-h-40"
      />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={disabled}
        onClick={() => notes.setEditedPlan(null)}
      >
        {translate('components.native-chat.approval.plan.discardEdit', 'Discard edits')}
      </Button>
    </div>
  )
}

export function NativeChatApprovalPlanEditButton({
  notes,
  disabled
}: {
  notes: NativeChatApprovalNotesState
  disabled: boolean
}): React.JSX.Element | null {
  if (!notes.canEditPlan || notes.editedPlan !== null) {
    return null
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      disabled={disabled}
      data-native-chat-approval-edit-plan="true"
      onClick={notes.startEditing}
      className="mt-2"
    >
      {translate('components.native-chat.approval.plan.edit', 'Edit plan')}
    </Button>
  )
}

export function NativeChatApprovalCommentField({
  notes,
  disabled
}: {
  notes: NativeChatApprovalNotesState
  disabled: boolean
}): React.JSX.Element | null {
  if (!notes.canComment) {
    return null
  }
  return (
    <Textarea
      value={notes.comment}
      disabled={disabled}
      data-native-chat-approval-comment="true"
      aria-label={translate('components.native-chat.approval.commentLabel', 'Comment')}
      placeholder={translate(
        'components.native-chat.approval.commentPlaceholder',
        'Add a comment for the agent (optional)'
      )}
      onChange={(event) => notes.setComment(event.target.value)}
      className="shrink-0"
    />
  )
}
