import type { NativeChatPromptEditorProps } from './native-chat-composer-input'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { getNativeChatComposerKeyClaims } from '../../../../shared/native-chat/native-chat-agent-profiles'
import { getShortcutPlatform } from '@/lib/shortcut-platform'

/** Mirror only profile-claimed keys; Windows/Linux keep Orca's Ctrl+L and Ctrl+N. */
export function useDroidComposerFocusMirror(enabled: boolean): {
  onFocus: () => void
  onBlur: () => void
} {
  // Only a focus this hook reported is released, so other agents and idle unmounts stay silent.
  const reportedRef = useRef(false)
  const focusedRef = useRef(false)
  const release = useCallback(() => {
    if (reportedRef.current) {
      reportedRef.current = false
      window.api.ui.setDroidComposerFocused(false)
    }
  }, [])
  const onFocus = useCallback(() => {
    focusedRef.current = true
    if (enabled) {
      reportedRef.current = true
      window.api.ui.setDroidComposerFocused(true)
    }
  }, [enabled])
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
  }, [enabled, onFocus, release])
  return useMemo(() => ({ onFocus, onBlur }), [onFocus, onBlur])
}

export function useDroidComposerFocusEvents(
  agent: string | undefined,
  events: Pick<NativeChatPromptEditorProps, 'onFocus' | 'onBlur'>
): Pick<NativeChatPromptEditorProps, 'onFocus' | 'onBlur'> {
  const claims = getNativeChatComposerKeyClaims(agent, getShortcutPlatform())
  const mirror = useDroidComposerFocusMirror(claims.includes('ctrlL') || claims.includes('ctrlN'))
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
