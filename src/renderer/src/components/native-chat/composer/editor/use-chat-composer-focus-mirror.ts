import type { AgentType } from '../../../../../../shared/agent-status/contracts/agent-status-types'
import type { NativeChatPromptEditorProps } from './native-chat-composer-input'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { getNativeChatComposerWindowShortcutKeys } from '../../../../../../shared/native-chat/native-chat-agent-profiles'
import { getShortcutPlatform } from '@/lib/keyboard/shortcut-platform'

/** Reports `agent` while its composer holds focus; null reports nothing. */
function useChatComposerFocusMirror(agent: AgentType | null): {
  onFocus: () => void
  onBlur: () => void
} {
  // Only a focus this hook reported is released, so silent agents and idle unmounts stay silent.
  const reportedRef = useRef(false)
  const focusedRef = useRef(false)
  const release = useCallback(() => {
    if (reportedRef.current) {
      reportedRef.current = false
      window.api.ui.setChatComposerFocused(null)
    }
  }, [])
  const onFocus = useCallback(() => {
    focusedRef.current = true
    if (agent) {
      reportedRef.current = true
      window.api.ui.setChatComposerFocused(agent)
    }
  }, [agent])
  const onBlur = useCallback(() => {
    focusedRef.current = false
    release()
  }, [release])
  useEffect(() => {
    const restore = () => {
      if (focusedRef.current) {
        onFocus()
      }
    }
    window.addEventListener('focus', restore)
    window.addEventListener('blur', release)
    restore()
    return () => {
      window.removeEventListener('focus', restore)
      window.removeEventListener('blur', release)
      release()
    }
  }, [onFocus, release])
  return useMemo(() => ({ onFocus, onBlur }), [onFocus, onBlur])
}

/** Main only needs a focused composer whose agent claims window chords on this OS. */
export function useChatComposerFocusEvents(
  agent: AgentType | undefined,
  events: Pick<NativeChatPromptEditorProps, 'onFocus' | 'onBlur'>
): Pick<NativeChatPromptEditorProps, 'onFocus' | 'onBlur'> {
  const claimsWindowChords =
    getNativeChatComposerWindowShortcutKeys(agent, getShortcutPlatform()).length > 0
  const mirror = useChatComposerFocusMirror(agent && claimsWindowChords ? agent : null)
  return {
    onFocus: (event) => {
      mirror.onFocus()
      events.onFocus?.(event)
    },
    onBlur: (event) => {
      mirror.onBlur()
      events.onBlur?.(event)
    }
  }
}
