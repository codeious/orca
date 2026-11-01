import type { Dispatch, RefObject, SetStateAction } from 'react'
import {
  nativeChatComposerSelectedText,
  type NativeChatComposerInput
} from './native-chat-composer-input'
import { useNativeChatDroidComposerKeys } from './use-native-chat-droid-composer-keys'
import { useNativeChatDroidTurnKeys } from './use-native-chat-droid-turn-keys'

/** Every Droid key a composer wires: the mode keys, then Ctrl+C and Esc over the composer's own input. */
export function useNativeChatComposerDroidKeys(
  args: Parameters<typeof useNativeChatDroidComposerKeys>[0] & {
    /** A prompt card owns the input. */
    inert: boolean
    /** Stops the running turn; absent when there is none to stop. */
    stopTurn: (() => void) | undefined
    input: RefObject<NativeChatComposerInput | null>
    draft: string
    hasAttachments: boolean
    /** What Esc empties: the text, its caret and picker, the skill origin, and the images. */
    clear: {
      setDraft: Dispatch<SetStateAction<string>>
      setCaret: Dispatch<SetStateAction<number>>
      setActiveSuggestion: Dispatch<SetStateAction<number>>
      clearSkillOrigin: () => void
      clearImageAttachments: () => void
    }
    /** Esc three times on an empty composer; absent where the chat has no rewind. */
    openRewind?: (() => void) | undefined
  }
): ReturnType<typeof useNativeChatDroidTurnKeys> {
  const { inert, stopTurn, input, draft, hasAttachments, clear, openRewind, ...modeArgs } = args
  const keys = useNativeChatDroidComposerKeys(modeArgs)
  return useNativeChatDroidTurnKeys({
    agent: args.agent,
    keys,
    inert,
    stopTurn,
    openRewind,
    selectedText: () => nativeChatComposerSelectedText(input.current),
    hasContent: draft !== '' || hasAttachments,
    clearComposer: () => {
      clear.setDraft('')
      clear.setCaret(0)
      clear.setActiveSuggestion(0)
      clear.clearSkillOrigin()
      clear.clearImageAttachments()
    }
  })
}
