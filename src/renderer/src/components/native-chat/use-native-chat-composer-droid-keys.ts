import { useContext, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import { NativeChatRewindContext } from './native-chat-rewind-context'
import { DROID_COMPOSER_KEYS } from '../../../../shared/droid-composer-keys'
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
  }
): ReturnType<typeof useNativeChatDroidTurnKeys> {
  const { inert, stopTurn, input, draft, hasAttachments, clear, ...modeArgs } = args
  const keys = useNativeChatDroidComposerKeys(modeArgs)
  if (inert && keys) {
    for (const key of DROID_COMPOSER_KEYS) {
      keys[key] = () => {}
    }
  }
  const rewind = useContext(NativeChatRewindContext)
  const confirm = useContext(ConfirmationDialogContext)
  const latest = rewind?.eligibleItemIds ? [...rewind.eligibleItemIds].at(-1) : undefined
  const requestRewind =
    rewind && !rewind.disabledReason && confirm && latest
      ? () => {
          void rewind.request(latest, confirm)
        }
      : undefined
  return useNativeChatDroidTurnKeys({
    agent: args.agent,
    keys,
    inert,
    stopTurn,
    openRewind: requestRewind,
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
