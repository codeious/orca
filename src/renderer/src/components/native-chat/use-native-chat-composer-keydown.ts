import {
  matchDroidComposerKey,
  type DroidComposerKey
} from '../../../../shared/droid-composer-keys'
import type { AgentType } from '../../../../shared/agent-status-types'
import { getNativeChatComposerKeyClaims } from '../../../../shared/native-chat/native-chat-agent-profiles'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import {
  useCallback,
  useRef,
  type Dispatch,
  type KeyboardEventHandler,
  type SetStateAction
} from 'react'
import type {
  ComposerAutocomplete,
  NativeChatPickerItem
} from '../../../../shared/native-chat-composer-autocomplete'
import { isMacPlatform } from './native-chat-shortcut'
import type { NativeChatMentionFiles } from './use-native-chat-mention-files'
import type { NativeChatComposerSendIntent } from './native-chat-composer-types'
import {
  isNativeChatRecallActive,
  nativeChatSentPrompts,
  stepNativeChatPromptRecall,
  type NativeChatComposerRecall
} from './native-chat-sent-prompt-history'

export type UseNativeChatComposerKeyDownArgs = {
  agent?: AgentType
  droidKeys?: Partial<Record<DroidComposerKey, () => void>>
  autocomplete: ComposerAutocomplete
  mentionFiles: NativeChatMentionFiles
  completeMention: (path: string) => void
  activeSuggestion: number
  draft: string
  /** Image chips count as composer content, like typed text. */
  hasAttachments?: boolean
  recall?: NativeChatComposerRecall | undefined
  isComposing: () => boolean
  completePickerItem: (item: NativeChatPickerItem) => void
  dispatchPickerCommand: (item: Extract<NativeChatPickerItem, { kind: 'command' }>) => void
  dismissPicker: (triggerKey: string) => void
  interrupt: () => void
  send: (intent?: NativeChatComposerSendIntent) => void
  /** Cmd/Ctrl+Shift+Enter steers the head queued card, whatever the composer holds. */
  steerHead?: (() => boolean) | undefined
  setActiveSuggestion: Dispatch<SetStateAction<number>>
  setDraft: Dispatch<SetStateAction<string>>
  setCaret: Dispatch<SetStateAction<number>>
}

export function useNativeChatComposerKeyDown({
  agent,
  droidKeys,
  autocomplete,
  mentionFiles,
  completeMention,
  activeSuggestion,
  draft,
  hasAttachments = false,
  recall,
  isComposing,
  completePickerItem,
  dispatchPickerCommand,
  dismissPicker,
  interrupt,
  send,
  steerHead,
  setActiveSuggestion,
  setDraft,
  setCaret
}: UseNativeChatComposerKeyDownArgs): KeyboardEventHandler<HTMLElement> {
  const claims = getNativeChatComposerKeyClaims(agent, getShortcutPlatform())
  // Read through a ref: the transcript changes on every streamed frame.
  const recallRef = useRef(recall)
  recallRef.current = recall
  return useCallback(
    (event) => {
      if (isComposing() || event.nativeEvent.isComposing || event.keyCode === 229) {
        // IME Enter commits composition; never pick a suggestion or submit a partial draft.
        if (event.key === 'Enter') {
          event.preventDefault()
        }
        return
      }
      // An open layer that keeps focus here, like the context card, already spent this Escape closing itself.
      if (event.key === 'Escape' && event.defaultPrevented) {
        return
      }

      if (autocomplete.mode !== 'none') {
        const items = autocomplete.mode === 'slash' ? autocomplete.items : mentionFiles.files
        if (event.key === 'ArrowDown' && items.length > 0) {
          event.preventDefault()
          setActiveSuggestion((index) => (index + 1) % items.length)
          return
        }
        if (event.key === 'ArrowUp' && items.length > 0) {
          event.preventDefault()
          setActiveSuggestion((index) => (index - 1 + items.length) % items.length)
          return
        }
        // Shift keeps its own meaning: a newline for Enter, focus back for Tab.
        const picks = (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey
        if (picks && items.length > 0) {
          event.preventDefault()
          if (autocomplete.mode === 'mention') {
            const { files } = mentionFiles
            completeMention(files[Math.min(activeSuggestion, files.length - 1)])
            return
          }
          const item = autocomplete.items[activeSuggestion] ?? autocomplete.items[0]
          // Only dispatch a command at a dispatchable prompt position; embedded tokens merely complete.
          if (event.key === 'Enter' && item.kind === 'command' && autocomplete.dispatchable) {
            dispatchPickerCommand(item)
          } else {
            completePickerItem(item)
          }
          return
        }
        // Why: the files are still on their way, so Enter here is a pick that came early, not a send.
        if (picks && autocomplete.mode === 'mention' && mentionFiles.loading) {
          event.preventDefault()
          return
        }
        // Why: Droid's Tab cycles effort, and a menu on screen outranks that even with no row to take it.
        // The exact chord match leaves Ctrl, Alt and Meta+Tab to the window shortcuts.
        if (
          claims.includes('tab') &&
          matchDroidComposerKey(event, getShortcutPlatform()) === 'tab'
        ) {
          event.preventDefault()
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          dismissPicker(autocomplete.triggerKey)
          return
        }
      }

      // Droid's map comes after IME and the open menu and before today's handling. Unwired keys fall through.
      const droidKey =
        claims.length > 0 && !event.defaultPrevented
          ? matchDroidComposerKey(event, getShortcutPlatform())
          : null
      const droidAction = droidKey && claims.includes(droidKey) ? droidKeys?.[droidKey] : undefined
      // Steers the waiting card and says whether it did. Platform primary modifier only (AGENTS.md):
      // ⌘ on Mac, Ctrl elsewhere. Only from an empty composer: the chord never sends a card past
      // what the user just wrote.
      const trySteerQueued = (): boolean =>
        (isMacPlatform() ? event.metaKey : event.ctrlKey) &&
        draft.trim() === '' &&
        !hasAttachments &&
        steerHead?.() === true
      if (droidAction) {
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat) {
          return
        }
        // Off a Mac that chord is also Droid's Ctrl+Enter, so a waiting card still goes first.
        if (!(droidKey === 'ctrlEnter' && trySteerQueued())) {
          droidAction()
        }
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        // Only Stop ends a Droid turn, even when its Escape is not wired.
        if (!claims.includes('escape')) {
          interrupt()
        }
        return
      }
      const modified = event.key === 'Enter' && (isMacPlatform() ? event.metaKey : event.ctrlKey)
      // Why before Shift+Enter: that adds a newline, and this chord leaves the draft alone.
      if (modified && event.shiftKey) {
        event.preventDefault()
        // A held chord would otherwise steer each card that becomes the head.
        if (!event.repeat) {
          steerHead?.()
        }
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (!modified) {
          send()
        } else if (draft.trim() !== '' || hasAttachments) {
          // The other thing than the setting; an empty composer has nothing to send either way.
          send(claims.includes('enter') ? undefined : { alternate: true })
        }
        return
      }
      const arrow = event.key === 'ArrowUp' || event.key === 'ArrowDown'
      // A modified arrow selects or jumps; attachments make the composer non-empty.
      const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey
      const recall = recallRef.current
      if (!arrow || !plain || hasAttachments || !recall) {
        return
      }
      const recalling = isNativeChatRecallActive(recall.position, draft)
      // Checked before the layout read and the prompt scan: a typed draft never recalls.
      if (!recalling && (event.key === 'ArrowDown' || draft !== '')) {
        return
      }
      if (!recall.isCaretOnVisualEdge(event.key === 'ArrowUp' ? 'start' : 'end')) {
        return
      }
      const step = stepNativeChatPromptRecall({
        direction: event.key === 'ArrowUp' ? 'back' : 'forward',
        prompts: nativeChatSentPrompts(recall.source),
        position: recall.position,
        draft
      })
      if (step) {
        event.preventDefault()
        recall.setPosition(step.position)
        setDraft(step.draft)
        setCaret(step.draft.length)
        recall.show(step.draft)
      }
    },
    [
      activeSuggestion,
      claims,
      autocomplete,
      completeMention,
      completePickerItem,
      dismissPicker,
      dispatchPickerCommand,
      draft,
      droidKeys,
      hasAttachments,
      interrupt,
      isComposing,
      mentionFiles,
      send,
      steerHead,
      setActiveSuggestion,
      setCaret,
      setDraft
    ]
  )
}
