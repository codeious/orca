import { keybindingMatchesInput, type KeybindingInput } from './keybindings'
import type { ComposerKey, ComposerKeyMap } from './native-chat/native-chat-composer-keys'

export const DROID_COMPOSER_KEYS = [
  'shiftTab',
  'ctrlL',
  'tab',
  'ctrlN',
  'enter',
  'ctrlEnter',
  'ctrlC',
  'escape'
] as const satisfies readonly ComposerKey[]

export type DroidComposerKey = (typeof DROID_COMPOSER_KEYS)[number]

/** Droid reads the Control key on every OS, Mac included, so these never use `Mod` or `Cmd`. */
export const DROID_COMPOSER_KEY_CHORDS: Record<DroidComposerKey, string> = {
  shiftTab: 'Shift+Tab',
  ctrlL: 'Ctrl+L',
  tab: 'Tab',
  ctrlN: 'Ctrl+N',
  enter: 'Enter',
  ctrlEnter: 'Ctrl+Enter',
  ctrlC: 'Ctrl+C',
  escape: 'Escape'
}

/** Esc pressed three times on an empty composer opens rewind only while each gap between presses
 *  is at most this long. Captured from Droid 0.251.0: 175 ms opened it, 200 ms did not. */
export const DROID_ESC_REWIND_GAP_MS = 175

/** The Droid key a keydown is, read by the same layout-aware matcher the main window uses. */
export function matchDroidComposerKey(
  input: KeybindingInput,
  platform: NodeJS.Platform
): DroidComposerKey | null {
  return (
    DROID_COMPOSER_KEYS.find((key) =>
      keybindingMatchesInput(DROID_COMPOSER_KEY_CHORDS[key], input, platform)
    ) ?? null
  )
}

// Windows/Linux keep Ctrl+L and Ctrl+N for Orca, even while the composer is focused.
const OFF_MAC_KEYS = DROID_COMPOSER_KEYS.filter((key) => key !== 'ctrlL' && key !== 'ctrlN')

export const DROID_COMPOSER_KEY_MAP: ComposerKeyMap = {
  match: matchDroidComposerKey,
  claims: { darwin: DROID_COMPOSER_KEYS, win32: OFF_MAC_KEYS, linux: OFF_MAC_KEYS },
  windowShortcutKeys: ['ctrlL', 'ctrlN']
}
