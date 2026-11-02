import type { KeyboardEvent } from 'react'
import { matchDroidComposerKey } from '../../../../shared/droid-composer-keys'
import { isEditableTarget } from '@/lib/editable-target'
import { getShortcutPlatform } from '@/lib/shortcut-platform'

/** The text selected inside the chat, or '' when nothing is or the selection reaches outside it. */
export function getNativeChatSelectedText(root: HTMLElement | null): string {
  const selection = window.getSelection()
  if (!root || !selection || selection.isCollapsed) {
    return ''
  }
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
    return ''
  }
  return selection.toString()
}

/** Control is not the browser's copy key on a Mac, so the clipboard is written here on every OS. */
export function copyNativeChatTranscriptSelection(
  event: KeyboardEvent,
  root: HTMLElement | null
): boolean {
  if (matchDroidComposerKey(event, getShortcutPlatform()) !== 'ctrlC') {
    return false
  }
  if (isEditableTarget(event.target)) {
    return false
  }
  const text = getNativeChatSelectedText(root)
  if (text === '') {
    return false
  }
  event.preventDefault()
  void window.api.ui.writeClipboardText(text)
  return true
}
