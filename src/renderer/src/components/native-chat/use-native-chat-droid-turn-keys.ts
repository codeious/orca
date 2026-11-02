import { useEffect, useRef } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { getNativeChatComposerKeyClaims } from '../../../../shared/native-chat/native-chat-agent-profiles'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import {
  DROID_ESC_REWIND_GAP_MS,
  type DroidComposerKey
} from '../../../../shared/droid-composer-keys'

type DroidKeys = Partial<Record<DroidComposerKey, () => void>>

/** Ctrl+C stops a turn once, so a repeat press can never be what closes the chat. Esc never stops one. */
export function useNativeChatDroidTurnKeys(args: {
  agent: AgentType | undefined
  /** The mode keys these join. */
  keys: DroidKeys | undefined
  /** A prompt card owns the input, so neither key is the composer's. */
  inert?: boolean
  /** Stops the running turn; absent when there is none to stop. */
  stopTurn: (() => void) | undefined
  selectedText: () => string
  /** Text or attachments waiting to be sent. */
  hasContent: boolean
  clearComposer: () => void
  /** Called on the third Esc of a run on an empty composer, each gap within the limit. */
  openRewind?: (() => void) | undefined
}): DroidKeys | undefined {
  const { agent, keys, inert, stopTurn, selectedText, hasContent, clearComposer, openRewind } = args
  const stoppedRef = useRef(false)
  const escRunRef = useRef({ count: 0, at: 0 })
  const canStop = stopTurn !== undefined
  // The host ending the turn is what re-arms the key; a Stop still in flight is not the end.
  useEffect(() => {
    if (!canStop) {
      stoppedRef.current = false
    }
  }, [canStop])
  if (!getNativeChatComposerKeyClaims(agent, getShortcutPlatform()).includes('escape')) {
    return keys
  }
  return {
    ...keys,
    ctrlC: () => {
      if (inert) {
        return
      }
      const selected = selectedText()
      if (selected !== '') {
        void window.api.ui.writeClipboardText(selected)
        return
      }
      if (!stopTurn || stoppedRef.current) {
        return
      }
      stoppedRef.current = true
      stopTurn()
    },
    escape: () => {
      if (inert) {
        return
      }
      const run = escRunRef.current
      // A press that clears the draft is not one of the three.
      if (hasContent) {
        run.count = 0
        clearComposer()
        return
      }
      const now = Date.now()
      run.count = run.count > 0 && now - run.at <= DROID_ESC_REWIND_GAP_MS ? run.count + 1 : 1
      run.at = now
      if (run.count === 3) {
        run.count = 0
        openRewind?.()
      }
    }
  }
}
