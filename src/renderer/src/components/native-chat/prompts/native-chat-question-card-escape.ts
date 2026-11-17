import type { KeyboardEvent } from 'react'
import { isEditableTarget } from '@/lib/text-input/focus/editable-target'

/** Runs a question card's Escape action unless it comes from a text field, where Escape is editing and folding would hide the draft. */
export function runNativeChatQuestionCardEscape(
  event: KeyboardEvent,
  action: (() => void) | undefined
): void {
  if (
    event.key !== 'Escape' ||
    event.nativeEvent.isComposing ||
    !action ||
    isEditableTarget(event.target)
  ) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  action()
}
