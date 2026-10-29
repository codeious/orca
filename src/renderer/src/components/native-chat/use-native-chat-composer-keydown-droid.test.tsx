// @vitest-environment happy-dom

// The Droid key map is one branch of the composer keydown hook, after IME and the open menu and
// before today's Escape/Enter handling. Every other agent must see no change at all.

import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import type { KeyboardEventHandler } from 'react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  DROID_COMPOSER_KEY_CHORDS,
  DROID_COMPOSER_KEYS,
  type DroidComposerKey
} from '../../../../shared/droid-composer-keys'
import type { ComposerAutocomplete } from './native-chat-composer-state'
import { useNativeChatComposerKeyDown } from './use-native-chat-composer-keydown'

const COMMAND = {
  kind: 'command' as const,
  id: 'command:clear',
  name: 'clear',
  token: '/clear',
  description: 'Clear history',
  skillCollision: false
}

const SLASH_MENU: ComposerAutocomplete = {
  mode: 'slash',
  query: '',
  items: [COMMAND],
  triggerKey: '/:0',
  prefix: '/',
  dispatchable: true,
  grouped: false,
  commandsEnabled: true,
  skillsEnabled: false,
  skillStatus: 'ready'
}

const NO_MENU: ComposerAutocomplete = { mode: 'none' }

type KeyInit = {
  key: string
  code?: string
  ctrlKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

const KEYS: Record<DroidComposerKey, KeyInit> = {
  shiftTab: { key: 'Tab', code: 'Tab', shiftKey: true },
  ctrlL: { key: 'l', code: 'KeyL', ctrlKey: true },
  tab: { key: 'Tab', code: 'Tab' },
  ctrlN: { key: 'n', code: 'KeyN', ctrlKey: true },
  enter: { key: 'Enter', code: 'Enter' },
  ctrlEnter: { key: 'Enter', code: 'Enter', ctrlKey: true },
  ctrlC: { key: 'c', code: 'KeyC', ctrlKey: true },
  escape: { key: 'Escape', code: 'Escape' }
}
const KEY_NAMES = DROID_COMPOSER_KEYS

function setup({
  agent,
  autocomplete = NO_MENU,
  composing = false,
  withDroidKeys = true
}: {
  agent?: string
  autocomplete?: ComposerAutocomplete
  composing?: boolean
  withDroidKeys?: boolean
} = {}) {
  const droidKeys = {
    shiftTab: vi.fn(),
    ctrlL: vi.fn(),
    tab: vi.fn(),
    ctrlN: vi.fn(),
    enter: vi.fn(),
    ctrlEnter: vi.fn(),
    ctrlC: vi.fn(),
    escape: vi.fn()
  } satisfies Record<DroidComposerKey, Mock>
  const callbacks = {
    completeMention: vi.fn(),
    completePickerItem: vi.fn(),
    dispatchPickerCommand: vi.fn(),
    dismissPicker: vi.fn(),
    interrupt: vi.fn(),
    send: vi.fn(),
    setActiveSuggestion: vi.fn(),
    setDraft: vi.fn(),
    setCaret: vi.fn()
  }
  const hook = renderHook(() =>
    useNativeChatComposerKeyDown({
      ...(agent ? { agent } : {}),
      ...(withDroidKeys ? { droidKeys } : {}),
      autocomplete,
      mentionFiles: { files: [], loading: false, failed: false },
      activeSuggestion: 0,
      draft: '',
      isComposing: () => composing,
      ...callbacks
    })
  )
  return { handler: hook.result.current, callbacks, droidKeys }
}

/** Presses a key on a real element and reports whether the composer kept the browser from acting. */
function press(handler: KeyboardEventHandler<HTMLElement>, init: KeyInit): { prevented: boolean } {
  render(<div data-testid="composer" onKeyDown={handler} />)
  const notPrevented = fireEvent.keyDown(screen.getByTestId('composer'), init)
  cleanup()
  return { prevented: !notPrevented }
}

function pressKeyCalls(droidKeys: ReturnType<typeof setup>['droidKeys']): string[] {
  return KEY_NAMES.filter((name) => droidKeys[name].mock.calls.length > 0)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Droid composer key map', () => {
  it.each(KEY_NAMES)('runs the %s action and keeps the key from the browser', (name) => {
    const { handler, callbacks, droidKeys } = setup({ agent: 'droid' })
    const { prevented } = press(handler, KEYS[name])
    expect(pressKeyCalls(droidKeys)).toEqual([name])
    expect(droidKeys[name]).toHaveBeenCalledOnce()
    expect(prevented).toBe(true)
    // The map is consulted before today's Escape and Enter handling, which must not also run.
    expect(callbacks.send).not.toHaveBeenCalled()
    expect(callbacks.interrupt).not.toHaveBeenCalled()
  })

  it('names each key with its literal Ctrl chord', () => {
    expect(DROID_COMPOSER_KEY_CHORDS.ctrlL).toBe('Ctrl+L')
    expect(DROID_COMPOSER_KEY_CHORDS.ctrlN).toBe('Ctrl+N')
  })

  it("leaves a key nobody has wired to today's handling", () => {
    const { handler, callbacks } = setup({ agent: 'droid', withDroidKeys: false })
    expect(press(handler, KEYS.enter).prevented).toBe(true)
    expect(callbacks.send).toHaveBeenCalledOnce()
    expect(press(handler, KEYS.escape).prevented).toBe(true)
    expect(callbacks.interrupt).toHaveBeenCalledOnce()
    expect(press(handler, KEYS.ctrlL).prevented).toBe(false)
    expect(press(handler, KEYS.shiftTab).prevented).toBe(false)
  })

  it('reads literal Ctrl on a Mac, and never Cmd', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X)'
    )
    const { handler, droidKeys } = setup({ agent: 'droid' })
    expect(press(handler, KEYS.ctrlL).prevented).toBe(true)
    expect(press(handler, KEYS.ctrlN).prevented).toBe(true)
    expect(droidKeys.ctrlL).toHaveBeenCalledOnce()
    expect(droidKeys.ctrlN).toHaveBeenCalledOnce()

    // Cmd+L and Cmd+N stay Orca's: the sidebar and Create worktree.
    expect(press(handler, { key: 'l', code: 'KeyL', metaKey: true }).prevented).toBe(false)
    expect(press(handler, { key: 'n', code: 'KeyN', metaKey: true }).prevented).toBe(false)
    expect(droidKeys.ctrlL).toHaveBeenCalledOnce()
    expect(droidKeys.ctrlN).toHaveBeenCalledOnce()
  })

  it.each(['Windows NT 10.0', 'X11; Linux x86_64'])(
    'reads Ctrl+L and Ctrl+N on %s',
    (agentString) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(`Mozilla/5.0 (${agentString})`)
      const { handler, droidKeys } = setup({ agent: 'droid' })
      press(handler, KEYS.ctrlL)
      press(handler, KEYS.ctrlN)
      expect(droidKeys.ctrlL).toHaveBeenCalledOnce()
      expect(droidKeys.ctrlN).toHaveBeenCalledOnce()
    }
  )

  it('does not run on Ctrl+L with another modifier held', () => {
    const { handler, droidKeys } = setup({ agent: 'droid' })
    press(handler, { ...KEYS.ctrlL, shiftKey: true })
    press(handler, { ...KEYS.ctrlN, altKey: true })
    expect(pressKeyCalls(droidKeys)).toEqual([])
  })

  describe('precedence', () => {
    it('yields to an IME composition before any Droid key', () => {
      const { handler, droidKeys } = setup({ agent: 'droid', composing: true })
      for (const name of KEY_NAMES) {
        press(handler, KEYS[name])
      }
      expect(pressKeyCalls(droidKeys)).toEqual([])
    })

    it('yields to an open slash menu that takes Tab', () => {
      const { handler, callbacks, droidKeys } = setup({ agent: 'droid', autocomplete: SLASH_MENU })
      press(handler, KEYS.tab)
      expect(callbacks.completePickerItem).toHaveBeenCalledWith(COMMAND)
      expect(droidKeys.tab).not.toHaveBeenCalled()
    })

    it('yields to an open slash menu that takes Enter and Escape', () => {
      const { handler, callbacks, droidKeys } = setup({ agent: 'droid', autocomplete: SLASH_MENU })
      press(handler, KEYS.enter)
      expect(callbacks.dispatchPickerCommand).toHaveBeenCalledOnce()
      press(handler, KEYS.escape)
      expect(callbacks.dismissPicker).toHaveBeenCalledWith('/:0')
      expect(droidKeys.enter).not.toHaveBeenCalled()
      expect(droidKeys.escape).not.toHaveBeenCalled()
      expect(callbacks.send).not.toHaveBeenCalled()
      expect(callbacks.interrupt).not.toHaveBeenCalled()
    })

    it('still runs the keys an open menu does not take', () => {
      const { handler, droidKeys } = setup({ agent: 'droid', autocomplete: SLASH_MENU })
      press(handler, KEYS.shiftTab)
      press(handler, KEYS.ctrlL)
      expect(droidKeys.shiftTab).toHaveBeenCalledOnce()
      expect(droidKeys.ctrlL).toHaveBeenCalledOnce()
    })

    it('yields to a layer that already spent the key', () => {
      const { handler, droidKeys } = setup({ agent: 'droid' })
      render(
        <div
          data-testid="outer"
          onKeyDown={handler}
          onKeyDownCapture={(event) => event.preventDefault()}
        />
      )
      for (const name of KEY_NAMES) {
        fireEvent.keyDown(screen.getByTestId('outer'), KEYS[name])
      }
      expect(pressKeyCalls(droidKeys)).toEqual([])
    })
  })
})

describe('keys of every agent but Droid', () => {
  const AGENTS = ['claude', 'codex', 'pi', 'grok', 'opencode', 'omp'] as const

  // Mode keys, Ctrl+C and Up/Down are not the composer's: they reach the browser unchanged.
  const UNTOUCHED: Record<string, KeyInit> = {
    'Shift+Tab': KEYS.shiftTab,
    Tab: KEYS.tab,
    'Ctrl+L': KEYS.ctrlL,
    'Ctrl+N': KEYS.ctrlN,
    'Ctrl+C': KEYS.ctrlC,
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp' },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown' }
  }

  describe.each(AGENTS)('%s', (agent) => {
    it.each(Object.keys(UNTOUCHED))(
      'leaves %s to the browser even with Droid keys wired',
      (key) => {
        const { handler, callbacks, droidKeys } = setup({ agent })
        expect(press(handler, UNTOUCHED[key]!).prevented).toBe(false)
        expect(pressKeyCalls(droidKeys)).toEqual([])
        expect(callbacks.send).not.toHaveBeenCalled()
        expect(callbacks.interrupt).not.toHaveBeenCalled()
        expect(callbacks.completePickerItem).not.toHaveBeenCalled()
      }
    )

    it('completes the highlighted row on Tab and leaves Shift+Tab unpicked in an open menu', () => {
      const { handler, callbacks, droidKeys } = setup({ agent, autocomplete: SLASH_MENU })
      press(handler, KEYS.shiftTab)
      expect(callbacks.completePickerItem).not.toHaveBeenCalled()
      press(handler, KEYS.tab)
      expect(callbacks.completePickerItem).toHaveBeenCalledWith(COMMAND)
      expect(pressKeyCalls(droidKeys)).toEqual([])
    })

    it('interrupts on Escape and sends on Enter', () => {
      const { handler, callbacks, droidKeys } = setup({ agent })
      press(handler, KEYS.escape)
      expect(callbacks.interrupt).toHaveBeenCalledOnce()
      press(handler, KEYS.enter)
      expect(callbacks.send).toHaveBeenCalledOnce()
      press(handler, KEYS.ctrlEnter)
      expect(callbacks.send).toHaveBeenCalledTimes(2)
      expect(pressKeyCalls(droidKeys)).toEqual([])
    })

    it('closes an open menu on Escape without interrupting', () => {
      const { handler, callbacks } = setup({ agent, autocomplete: SLASH_MENU })
      press(handler, KEYS.escape)
      expect(callbacks.dismissPicker).toHaveBeenCalledWith('/:0')
      expect(callbacks.interrupt).not.toHaveBeenCalled()
    })

    it('inserts a newline on Shift+Enter instead of sending', () => {
      const { handler, callbacks } = setup({ agent })
      expect(press(handler, { key: 'Enter', code: 'Enter', shiftKey: true }).prevented).toBe(false)
      expect(callbacks.send).not.toHaveBeenCalled()
    })
  })

  it('treats a composer with no agent like any other', () => {
    const { handler, callbacks, droidKeys } = setup()
    press(handler, KEYS.escape)
    expect(callbacks.interrupt).toHaveBeenCalledOnce()
    expect(press(handler, KEYS.ctrlL).prevented).toBe(false)
    expect(pressKeyCalls(droidKeys)).toEqual([])
  })
})
