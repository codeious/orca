import { useCallback, useEffect, useMemo, useRef } from 'react'

/** Tells the main process while a Droid composer holds focus, so Ctrl+L and Ctrl+N reach it
 *  instead of Orca's own shortcuts. Only Droid reports; every other agent keeps those chords. */
export function useDroidComposerFocusMirror(enabled: boolean): {
  onFocus: () => void
  onBlur: () => void
} {
  // Only a focus this hook reported is released, so other agents and idle unmounts stay silent.
  const reportedRef = useRef(false)
  const release = useCallback(() => {
    if (reportedRef.current) {
      reportedRef.current = false
      window.api.ui.setDroidComposerFocused(false)
    }
  }, [])
  const onFocus = useCallback(() => {
    if (enabled) {
      reportedRef.current = true
      window.api.ui.setDroidComposerFocused(true)
    }
  }, [enabled])
  // Runs on unmount, and when the chat stops being Droid while focused.
  useEffect(() => release, [enabled, release])
  return useMemo(() => ({ onFocus, onBlur: release }), [onFocus, release])
}
