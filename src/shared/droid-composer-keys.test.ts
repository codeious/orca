import { describe, expect, it } from 'vitest'
import {
  DROID_COMPOSER_KEY_CHORDS,
  isDroidComposerMainWindowChord,
  matchDroidComposerKey
} from './droid-composer-keys'
import type { KeybindingInput } from './keybindings'

const PLATFORMS = ['darwin', 'linux', 'win32'] as const

describe('Droid composer key chords', () => {
  it('names every chord with the literal Ctrl key, never Mod, Cmd, or a Command glyph', () => {
    expect(DROID_COMPOSER_KEY_CHORDS).toEqual({
      shiftTab: 'Shift+Tab',
      ctrlL: 'Ctrl+L',
      tab: 'Tab',
      ctrlN: 'Ctrl+N',
      enter: 'Enter',
      ctrlEnter: 'Ctrl+Enter',
      ctrlC: 'Ctrl+C',
      escape: 'Escape'
    })
    for (const chord of Object.values(DROID_COMPOSER_KEY_CHORDS)) {
      expect(chord).not.toMatch(/mod|cmd|command|meta|⌘/i)
    }
  })

  it.each(PLATFORMS)('matches each chord by its own modifiers on %s', (platform) => {
    const press = (input: KeybindingInput) => matchDroidComposerKey(input, platform)
    expect(press({ key: 'Tab', code: 'Tab', shiftKey: true })).toBe('shiftTab')
    expect(press({ key: 'Tab', code: 'Tab' })).toBe('tab')
    expect(press({ key: 'l', code: 'KeyL', ctrlKey: true })).toBe('ctrlL')
    expect(press({ key: 'n', code: 'KeyN', ctrlKey: true })).toBe('ctrlN')
    expect(press({ key: 'Enter', code: 'Enter' })).toBe('enter')
    expect(press({ key: 'Enter', code: 'Enter', ctrlKey: true })).toBe('ctrlEnter')
    expect(press({ key: 'c', code: 'KeyC', ctrlKey: true })).toBe('ctrlC')
    expect(press({ key: 'Escape', code: 'Escape' })).toBe('escape')
    // Electron's before-input-event spells the modifiers without the Key suffix.
    expect(press({ key: 'n', code: 'KeyN', control: true })).toBe('ctrlN')
  })

  it.each(PLATFORMS)('leaves a chord with any other modifier to its owner on %s', (platform) => {
    const press = (input: KeybindingInput) => matchDroidComposerKey(input, platform)
    // Cmd is Orca's key on a Mac; Droid's chords are literal Ctrl.
    expect(press({ key: 'l', code: 'KeyL', metaKey: true })).toBeNull()
    expect(press({ key: 'n', code: 'KeyN', metaKey: true })).toBeNull()
    expect(press({ key: 'l', code: 'KeyL', ctrlKey: true, shiftKey: true })).toBeNull()
    expect(press({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true })).toBeNull()
    expect(press({ key: 'Tab', code: 'Tab', ctrlKey: true })).toBeNull()
    expect(press({ key: 'Enter', code: 'Enter', shiftKey: true })).toBeNull()
    expect(press({ key: 'Escape', code: 'Escape', shiftKey: true })).toBeNull()
    expect(press({ key: 'x', code: 'KeyX', ctrlKey: true })).toBeNull()
  })

  it.each(['linux', 'win32'] as const)(
    'reads Ctrl+L and Ctrl+N from their physical keys on a non-Latin layout on %s',
    (platform) => {
      expect(matchDroidComposerKey({ key: 'д', code: 'KeyL', ctrlKey: true }, platform)).toBe(
        'ctrlL'
      )
      expect(matchDroidComposerKey({ key: 'т', code: 'KeyN', ctrlKey: true }, platform)).toBe(
        'ctrlN'
      )
    }
  )

  it('does not read AltGr as Ctrl+L', () => {
    expect(
      matchDroidComposerKey({ key: 'ł', code: 'KeyL', ctrlKey: true, altKey: true }, 'win32')
    ).toBeNull()
  })

  describe('the chords the main window must leave to the composer', () => {
    it.each(PLATFORMS)('are plain Ctrl+L and Ctrl+N only, on %s', (platform) => {
      const chord = (input: KeybindingInput) => isDroidComposerMainWindowChord(input, platform)
      expect(chord({ key: 'l', code: 'KeyL', control: true })).toBe(true)
      expect(chord({ key: 'n', code: 'KeyN', control: true })).toBe(true)
      expect(chord({ key: 'д', code: 'KeyL', control: true })).toBe(platform !== 'darwin')
      // Create-from keeps Ctrl+Shift+N; Ctrl+Tab, Ctrl+C, and Ctrl+Enter are not main-window chords.
      expect(chord({ key: 'N', code: 'KeyN', control: true, shift: true })).toBe(false)
      expect(chord({ key: 'l', code: 'KeyL', meta: true })).toBe(false)
      expect(chord({ key: 'b', code: 'KeyB', control: true })).toBe(false)
      expect(chord({ key: 'c', code: 'KeyC', control: true })).toBe(false)
      expect(chord({ key: 'Tab', code: 'Tab', control: true })).toBe(false)
    })
  })
})
