import type { AgentType } from '../../../../../../shared/agent-status/contracts/agent-status-types'
import type { KeybindingInput } from '../../../../../../shared/keybindings'
import {
  getNativeChatComposerKeyClaims,
  getNativeChatAgentProfile,
  matchNativeChatComposerKey
} from '../../../../../../shared/native-chat/native-chat-agent-profiles'
import {
  composerKeyAction,
  type ComposerKey,
  type ComposerKeyActions
} from '../../../../../../shared/native-chat/native-chat-composer-keys'
import { getShortcutPlatform } from '@/lib/keyboard/shortcut-platform'
import {
  useCallback,
  useRef,
  type Dispatch,
  type KeyboardEventHandler,
  type SetStateAction
} from 'react'
import type { ComposerAutocomplete } from '../../../../../../shared/native-chat/input/native-chat-composer-autocomplete'
import type { NativeChatPickerItem } from '../../../../../../shared/native-chat/input/native-chat-picker-items'
import { isMacPlatform } from '../../pane/routing/native-chat-shortcut'
import type { NativeChatMentionFiles } from '../pickers/use-native-chat-mention-files'
import type { NativeChatComposerSendIntent } from '../submit/native-chat-composer-send-intent'
import {
  isNativeChatRecallActive,
  nativeChatSentPrompts,
  stepNativeChatPromptRecall,
  type NativeChatComposerRecall
} from '../../drafts/native-chat-sent-prompt-history'

export type UseNativeChatComposerKeyDownArgs = {
  agent?: AgentType
  /** Actions for the keys the agent's registered key map claims; unwired claimed keys fall through. */
  providerKeys?: ComposerKeyActions | undefined
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
  /** Cmd/Ctrl+Enter on an empty composer sends the head card now: where its other way is a steer, or no turn runs (a stopped, paused queue). */
  chordSteersHead?: boolean
  setActiveSuggestion: Dispatch<SetStateAction<number>>
  setDraft: Dispatch<SetStateAction<string>>
  setCaret: Dispatch<SetStateAction<number>>
}

/** The provider action a keydown runs: a key `agent` claims, wired in `actions`, not spent by an outer layer. */
export function nativeChatComposerProviderKey(
  agent: AgentType | undefined,
  actions: ComposerKeyActions | undefined,
  event: KeybindingInput & { defaultPrevented: boolean },
  platform: NodeJS.Platform
): { key: ComposerKey; run: () => void } | null {
  return composerKeyAction(getNativeChatAgentProfile(agent)?.composerKeys, actions, event, platform)
}

export function useNativeChatComposerKeyDown({
  agent,
  providerKeys,
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
  chordSteersHead = false,
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
      // An open layer that keeps focus here, like the context card, already spent this Escape closing
      // itself; a layer around the composer (a launch panel) leaves an open picker to take it.
      if (event.key === 'Escape' && event.defaultPrevented && autocomplete.mode === 'none') {
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
        // Why: a menu on screen outranks a provider's Tab even with no row to take it.
        // The exact chord match leaves Ctrl, Alt and Meta+Tab to the window shortcuts.
        if (matchNativeChatComposerKey(agent, event, getShortcutPlatform()) === 'tab') {
          event.preventDefault()
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          dismissPicker(autocomplete.triggerKey)
          return
        }
      }

      // The provider's keys come after IME and the open menu and before today's handling. Unwired keys fall through.
      const providerKey = nativeChatComposerProviderKey(
        agent,
        providerKeys,
        event,
        getShortcutPlatform()
      )
      // Steers the waiting card and says whether it did. Platform primary modifier only (AGENTS.md):
      // ⌘ on Mac, Ctrl elsewhere. Only from an empty composer: the chord never sends a card past
      // what the user just wrote.
      const trySteerQueued = (): boolean =>
        (isMacPlatform() ? event.metaKey : event.ctrlKey) &&
        draft.trim() === '' &&
        !hasAttachments &&
        steerHead?.() === true
      if (providerKey) {
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat) {
          return
        }
        // Off a Mac the steer chord is also a provider's Ctrl+Enter, so a waiting card still goes first.
        if (!(providerKey.key === 'ctrlEnter' && trySteerQueued())) {
          providerKey.run()
        }
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        // A provider that claims Escape ends turns only through Stop, even when its Escape is not wired.
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
        } else if (chordSteersHead && !event.repeat) {
          // Nothing of its own to steer, so the head card goes; never where the chord means queue,
          // or a second press would steer the card the first one just queued.
          steerHead?.()
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
      agent,
      claims,
      autocomplete,
      completeMention,
      completePickerItem,
      dismissPicker,
      dispatchPickerCommand,
      draft,
      providerKeys,
      hasAttachments,
      interrupt,
      isComposing,
      mentionFiles,
      send,
      steerHead,
      chordSteersHead,
      setActiveSuggestion,
      setCaret,
      setDraft
    ]
  )
}
