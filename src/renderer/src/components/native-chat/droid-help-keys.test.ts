import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DROID_COMPOSER_KEY_CHORDS } from '../../../../shared/droid-composer-keys'
import { DROID_HOST_COMMAND_NAMES } from '../../../../shared/droid-command-registry'
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
  it('lists the four mode bindings first, each led by its chord', () => {
    const lines = droidHelpKeyLines()
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

  it('lists the whole key map, one line per key, each led by its label', () => {
    const labels = droidHelpKeyLines().map((line) => line.slice(0, line.indexOf(':')))
    expect(labels).toEqual([
      'Shift+Tab',
      'Ctrl+L',
      'Tab',
      'Ctrl+N',
      'Enter',
      'Ctrl+Enter',
      'Ctrl+C',
      'Esc',
      'Esc three times'
    ])
  })

  it('says what Enter, Ctrl+Enter, Ctrl+C and Esc do while Droid works', () => {
    const [enter, ctrlEnter, ctrlC, escape, escapeThree] = droidHelpKeyLines().slice(4)
    expect(enter).toMatch(/steers/i)
    expect(ctrlEnter).toMatch(/wait/i)
    expect(ctrlEnter).toMatch(/answers after its current reply/i)
    expect(ctrlC).toMatch(/copies the selected text/i)
    expect(ctrlC).toMatch(/with none selected, it stops the running reply once/i)
    expect(ctrlC).toMatch(/never closes the chat, ends the Droid session or quits Orca/i)
    expect(escape).toMatch(/never stops a reply/i)
    expect(escapeThree).toMatch(/rewind/i)
  })

  it('reads as one paragraph holding every binding', () => {
    const text = droidHelpText()
    expect(text).not.toContain('\n')
    for (const line of droidHelpKeyLines()) {
      expect(text).toContain(line)
    }
  })

  it('lists every registered command ahead of the keys, from the registry', () => {
    const text = droidHelpText()
    expect(DROID_HOST_COMMAND_NAMES.length).toBeGreaterThan(0)
    for (const name of DROID_HOST_COMMAND_NAMES) {
      expect(text).toContain(`/${name}:`)
      expect(text.indexOf(`/${name}:`)).toBeLessThan(text.indexOf('Shift+Tab:'))
    }
  })

  it.each([
    ['Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'],
    ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'],
    ['Linux', 'Mozilla/5.0 (X11; Linux x86_64)']
  ])('writes Ctrl+, never a Command glyph or Cmd, on %s', (_os, userAgent) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
    const text = droidHelpText()
    for (const chord of ['Ctrl+L', 'Ctrl+N', 'Ctrl+Enter', 'Ctrl+C']) {
      expect(text).toContain(chord)
    }
    expect(text).not.toMatch(/⌘|⌃|Cmd|Command|Meta/)
    expect(text).toBe(droidHelpText())
  })

  it('keeps each Ctrl chord in en.json as one plain string with no per-OS branch', () => {
    const entries = enHelpEntries()
    for (const [name, chord] of [
      ['ctrlL', 'Ctrl+L'],
      ['ctrlN', 'Ctrl+N'],
      ['ctrlEnter', 'Ctrl+Enter'],
      ['ctrlC', 'Ctrl+C']
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
