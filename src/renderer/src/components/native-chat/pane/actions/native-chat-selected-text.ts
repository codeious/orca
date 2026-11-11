import type { KeyboardEvent } from 'react'
import type { AgentType } from '../../../../../../shared/agent-status/contracts/agent-status-types'
import { matchNativeChatComposerKey } from '../../../../../../shared/native-chat/native-chat-agent-profiles'
import { isEditableTarget } from '@/lib/text-input/focus/editable-target'
import { getShortcutPlatform } from '@/lib/keyboard/shortcut-platform'
import { markdownMathSelectionText } from '../../../../../../shared/markdown/markdown-math-selection'

/** The text selected inside the chat, or '' when nothing is or the selection reaches outside it. */
export function getNativeChatSelectedText(root: HTMLElement | null): string {
  const selection = window.getSelection()
  if (!root || !selection || selection.isCollapsed) {
    return ''
  }
  const anchor = selection.anchorNode
  const focus = selection.focusNode
  if (!nodeBelongsToRoot(anchor, root) || !nodeBelongsToRoot(focus, root)) {
    return ''
  }
  return markdownMathSelectionText(selection, root) ?? selection.toString()
}

function nodeBelongsToRoot(node: Node | null, root: HTMLElement): boolean {
  if (!node) {
    return false
  }
  return root.contains(node)
}

/** For an agent that claims Ctrl+C: Control is not the browser's copy key on a Mac, so the clipboard is written here on every OS. */
export function copyNativeChatTranscriptSelection(
  event: KeyboardEvent,
  root: HTMLElement | null,
  agent: AgentType | undefined
): boolean {
  if (matchNativeChatComposerKey(agent, event, getShortcutPlatform()) !== 'ctrlC') {
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
