import { keybindingMatchesInput, type KeybindingInput } from './keybindings'

export const DROID_COMPOSER_KEYS = [
  'shiftTab',
  'ctrlL',
  'tab',
  'ctrlN',
  'enter',
  'ctrlEnter',
  'ctrlC',
  'escape'
] as const

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

/** Orca's own Toggle Right Sidebar and Create worktree chords are these two Droid keys. */
export function isDroidComposerMainWindowChord(
  input: KeybindingInput,
  platform: NodeJS.Platform
): boolean {
  const key = matchDroidComposerKey(input, platform)
  return key === 'ctrlL' || key === 'ctrlN'
}
