// @vitest-environment happy-dom

// The Droid key map is wired on the menu cases so a non-Droid agent reading it fails the test.

import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useState, type KeyboardEventHandler } from 'react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { DroidComposerKey } from '../../../../shared/droid-composer-keys'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { ComposerAutocomplete } from './native-chat-composer-state'
import { NON_DROID_AGENTS } from '../../../../shared/non-droid-composer-key-agents.test-fixture'
import { useNativeChatComposerKeyDown } from './use-native-chat-composer-keydown'
import { useNativeChatRecallPosition } from './use-native-chat-composer-recall'

const MENTION_MENU: ComposerAutocomplete = { mode: 'mention', query: 'app', triggerKey: '@:5' }
const FILES = ['src/app.ts', 'src/app.css', 'app.md']

const TAB = { key: 'Tab', code: 'Tab' }
const SHIFT_TAB = { ...TAB, shiftKey: true }
const ESCAPE = { key: 'Escape', code: 'Escape' }

function newDroidKeys() {
  return {
    shiftTab: vi.fn(),
    ctrlL: vi.fn(),
    tab: vi.fn(),
    ctrlN: vi.fn(),
    enter: vi.fn(),
    ctrlEnter: vi.fn(),
    ctrlC: vi.fn(),
    escape: vi.fn()
  } satisfies Record<DroidComposerKey, Mock>
}

function press(handler: KeyboardEventHandler<HTMLElement>, init: KeyboardEventInit): boolean {
  render(<div data-testid="composer" onKeyDown={handler} />)
  const notPrevented = fireEvent.keyDown(screen.getByTestId('composer'), init)
  cleanup()
  return !notPrevented
}

function setupMentionMenu(agent: (typeof NON_DROID_AGENTS)[number], activeSuggestion: number) {
  const droidKeys = newDroidKeys()
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
      agent,
      droidKeys,
      autocomplete: MENTION_MENU,
      mentionFiles: { files: FILES, loading: false, failed: false },
      activeSuggestion,
      draft: 'open @app',
      isComposing: () => false,
      ...callbacks
    })
  )
  return { handler: hook.result.current, callbacks, droidKeys }
}

function expectDraftAndDroidKeysUntouched(
  { callbacks, droidKeys }: ReturnType<typeof setupMentionMenu>,
  except: readonly string[] = []
) {
  for (const [name, callback] of Object.entries({ ...callbacks, ...droidKeys })) {
    if (!except.includes(name)) {
      expect(callback, name).not.toHaveBeenCalled()
    }
  }
}

afterEach(() => {
  cleanup()
})

describe('an @ menu with a highlighted file row, on every agent but Droid', () => {
  it.each(NON_DROID_AGENTS)('completes the highlighted file on Tab for %s', (agent) => {
    const setup = setupMentionMenu(agent, 1)
    expect(press(setup.handler, TAB)).toBe(true)
    expect(setup.callbacks.completeMention).toHaveBeenCalledExactlyOnceWith('src/app.css')
    expectDraftAndDroidKeysUntouched(setup, ['completeMention'])
  })

  it.each(NON_DROID_AGENTS)('leaves the highlighted file unpicked on Shift+Tab for %s', (agent) => {
    const setup = setupMentionMenu(agent, 1)
    expect(press(setup.handler, SHIFT_TAB)).toBe(false)
    expectDraftAndDroidKeysUntouched(setup)
  })

  it.each(NON_DROID_AGENTS)('closes the menu on Esc and keeps the draft for %s', (agent) => {
    const setup = setupMentionMenu(agent, 1)
    expect(press(setup.handler, ESCAPE)).toBe(true)
    expect(setup.callbacks.dismissPicker).toHaveBeenCalledExactlyOnceWith('@:5')
    expectDraftAndDroidKeysUntouched(setup, ['dismissPicker'])
  })
})

describe('Up and Down recall of a sent prompt, on every agent but Droid', () => {
  const userMessage = (id: string, text: string): NativeChatMessage => ({
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  })

  type Edge = 'start' | 'end'

  function Composer({
    agent,
    initialDraft,
    isCaretOnVisualEdge
  }: {
    agent: (typeof NON_DROID_AGENTS)[number]
    initialDraft: string
    isCaretOnVisualEdge: (edge: Edge) => boolean
  }): React.JSX.Element {
    const [draft, setDraft] = useState(initialDraft)
    const [position, setPosition] = useNativeChatRecallPosition(draft)
    const onKeyDown = useNativeChatComposerKeyDown({
      agent,
      autocomplete: { mode: 'none' },
      mentionFiles: { files: [], loading: false, failed: false },
      completeMention: vi.fn(),
      activeSuggestion: 0,
      draft,
      recall: {
        source: { messages: [userMessage('0', 'first'), userMessage('1', 'second')] },
        position,
        setPosition,
        isCaretOnVisualEdge,
        show: vi.fn()
      },
      isComposing: () => false,
      completePickerItem: vi.fn(),
      dispatchPickerCommand: vi.fn(),
      dismissPicker: vi.fn(),
      interrupt: vi.fn(),
      send: vi.fn(),
      setActiveSuggestion: vi.fn(),
      setDraft,
      setCaret: vi.fn()
    })
    return (
      <textarea
        aria-label="composer"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
    )
  }

  function setup(
    agent: (typeof NON_DROID_AGENTS)[number],
    { initialDraft = '' }: { initialDraft?: string } = {}
  ) {
    let edges: readonly Edge[] = ['start', 'end']
    const field = render(
      <Composer
        agent={agent}
        initialDraft={initialDraft}
        isCaretOnVisualEdge={(edge) => edges.includes(edge)}
      />
    ).container.querySelector('textarea')!
    const press = (key: 'ArrowUp' | 'ArrowDown') => {
      const claimed = !fireEvent.keyDown(field, { key })
      return { draft: field.value, claimed }
    }
    return {
      press,
      caretOn: (...next: Edge[]) => {
        edges = next
      }
    }
  }

  it.each(NON_DROID_AGENTS)(
    'walks back on Up and forward on Down from an empty draft for %s',
    (agent) => {
      const { press } = setup(agent)
      expect(press('ArrowDown')).toEqual({ draft: '', claimed: false })
      expect(press('ArrowUp')).toEqual({ draft: 'second', claimed: true })
      expect(press('ArrowUp')).toEqual({ draft: 'first', claimed: true })
      expect(press('ArrowDown')).toEqual({ draft: 'second', claimed: true })
      expect(press('ArrowDown')).toEqual({ draft: '', claimed: true })
    }
  )

  it.each(NON_DROID_AGENTS)(
    'leaves Up to the caret while a typed draft is live for %s',
    (agent) => {
      const { press } = setup(agent, { initialDraft: 'typing' })
      expect(press('ArrowUp')).toEqual({ draft: 'typing', claimed: false })
      expect(press('ArrowDown')).toEqual({ draft: 'typing', claimed: false })
    }
  )

  it.each(NON_DROID_AGENTS)('needs the caret on the start edge for Up for %s', (agent) => {
    const { press, caretOn } = setup(agent)
    caretOn('end')
    expect(press('ArrowUp')).toEqual({ draft: '', claimed: false })
    caretOn('start')
    expect(press('ArrowUp')).toEqual({ draft: 'second', claimed: true })
    caretOn('end')
    expect(press('ArrowUp')).toEqual({ draft: 'second', claimed: false })
  })

  it.each(NON_DROID_AGENTS)('needs the caret on the end edge for Down for %s', (agent) => {
    const { press, caretOn } = setup(agent)
    press('ArrowUp')
    caretOn('start')
    expect(press('ArrowDown')).toEqual({ draft: 'second', claimed: false })
    caretOn('end')
    expect(press('ArrowDown')).toEqual({ draft: '', claimed: true })
  })

  it.each(NON_DROID_AGENTS)(
    'leaves both arrows to the caret away from both edges for %s',
    (agent) => {
      const { press, caretOn } = setup(agent)
      press('ArrowUp')
      caretOn()
      expect(press('ArrowUp')).toEqual({ draft: 'second', claimed: false })
      expect(press('ArrowDown')).toEqual({ draft: 'second', claimed: false })
    }
  )
})
