import { describe, expect, it } from 'vitest'
import {
  composerOwnsWindowChord,
  composerKeyAction,
  matchComposerKey,
  type ComposerKeyMap
} from './native-chat-composer-keys'

const keyMap: ComposerKeyMap = {
  match: (input) => {
    if (!input.ctrlKey || input.metaKey || input.altKey || input.shiftKey) {
      return null
    }
    return input.key === 'l' ? 'ctrlL' : input.key === 'n' ? 'ctrlN' : null
  },
  claims: { darwin: ['ctrlL', 'ctrlN'], linux: ['ctrlN'], win32: ['ctrlN'] },
  windowShortcutKeys: ['ctrlL']
}

describe('composer key decisions', () => {
  it('routes a wired claim unless another layer already spent the event', () => {
    let result = ''
    const actions = {
      ctrlL: () => {
        result = 'picked'
      }
    }
    const event = { key: 'l', ctrlKey: true, defaultPrevented: false }
    composerKeyAction(keyMap, actions, event, 'darwin')?.run()
    expect(result).toBe('picked')
    expect(composerKeyAction(keyMap, actions, event, 'linux')).toBeNull()
    expect(composerKeyAction(keyMap, {}, event, 'darwin')).toBeNull()
    expect(
      composerKeyAction(keyMap, actions, { ...event, defaultPrevented: true }, 'darwin')
    ).toBeNull()
  })

  it('yields only window chords also claimed on this OS', () => {
    expect(composerOwnsWindowChord(keyMap, { key: 'l', ctrlKey: true }, 'darwin')).toBe(true)
    expect(composerOwnsWindowChord(keyMap, { key: 'n', ctrlKey: true }, 'darwin')).toBe(false)
    expect(composerOwnsWindowChord(keyMap, { key: 'l', ctrlKey: true }, 'linux')).toBe(false)
    expect(composerOwnsWindowChord(keyMap, { key: 'l', ctrlKey: true }, 'win32')).toBe(false)
  })

  it('matches only keys claimed on the client OS', () => {
    expect(matchComposerKey(keyMap, { key: 'l', ctrlKey: true }, 'darwin')).toBe('ctrlL')
    expect(matchComposerKey(keyMap, { key: 'l', ctrlKey: true }, 'linux')).toBeNull()
    expect(matchComposerKey(keyMap, { key: 'l', ctrlKey: true }, 'win32')).toBeNull()
    expect(matchComposerKey(keyMap, { key: 'n', ctrlKey: true }, 'linux')).toBe('ctrlN')
    expect(matchComposerKey(keyMap, { key: 'l', metaKey: true }, 'darwin')).toBeNull()
    expect(matchComposerKey(undefined, { key: 'l', ctrlKey: true }, 'darwin')).toBeNull()
  })
})
