import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DROID_COMPOSER_KEY_CHORDS } from '../../../../shared/droid-composer-keys'
import { answerDroidHostCommand, droidHelpKeyLines, droidHelpText } from './droid-help-keys'

const EN_CATALOG_PATH = join(__dirname, '../../i18n/locales/en.json')

function enHelpEntries(): Record<string, unknown> {
  const catalog = JSON.parse(readFileSync(EN_CATALOG_PATH, 'utf8'))
  return catalog.components['native-chat'].droidHelp
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Droid /help key list', () => {
  it('lists the four mode bindings, each led by its chord', () => {
    const lines = droidHelpKeyLines()
    expect(lines).toHaveLength(4)
    const chords = [
      DROID_COMPOSER_KEY_CHORDS.shiftTab,
      DROID_COMPOSER_KEY_CHORDS.ctrlL,
      DROID_COMPOSER_KEY_CHORDS.tab,
      DROID_COMPOSER_KEY_CHORDS.ctrlN
    ]
    chords.forEach((chord, index) => {
      expect(lines[index]!.startsWith(`${chord}:`)).toBe(true)
    })
    expect(lines[0]).toMatch(/Spec/)
    expect(lines[1]).toMatch(/autonomy/i)
    expect(lines[2]).toMatch(/reasoning effort/i)
    expect(lines[3]).toMatch(/models/i)
  })

  it('reads as one paragraph holding every binding', () => {
    const text = droidHelpText()
    expect(text).not.toContain('\n')
    for (const line of droidHelpKeyLines()) {
      expect(text).toContain(line)
    }
  })

  it.each([
    ['Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'],
    ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'],
    ['Linux', 'Mozilla/5.0 (X11; Linux x86_64)']
  ])('writes Ctrl+, never a Command glyph or Cmd, on %s', (_os, userAgent) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
    const text = droidHelpText()
    expect(text).toContain('Ctrl+L')
    expect(text).toContain('Ctrl+N')
    expect(text).not.toMatch(/⌘|⌃|Cmd|Command|Meta/)
    expect(text).toBe(droidHelpText())
  })

  it('keeps each Ctrl chord in en.json as one plain string with no per-OS branch', () => {
    const entries = enHelpEntries()
    for (const [name, chord] of [
      ['ctrlL', 'Ctrl+L'],
      ['ctrlN', 'Ctrl+N']
    ]) {
      const value = entries[name]
      expect(typeof value).toBe('string')
      expect(value).toContain(chord)
      expect(value).not.toMatch(/⌘|Cmd|Command|_mac|\{\{/)
    }
    expect(Object.keys(entries).filter((key) => /mac|darwin|cmd/i.test(key))).toEqual([])
  })

  it('answers /help on the host and nothing else', () => {
    expect(answerDroidHostCommand('help')).toBe(droidHelpText())
    expect(answerDroidHostCommand('clear')).toBeNull()
    expect(answerDroidHostCommand('model')).toBeNull()
  })
})
