// @vitest-environment happy-dom

// The Droid keys against a real option state and the real composer keydown handler: Ctrl+N and Tab
// move the pills the picker draws, and while a turn runs the four mode keys are held without a
// side effect. A cold chat names no default model, which is where a fresh chat starts.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionModelCatalogResult } from '../../../../shared/agent-session-wire'
import type { SessionOptionsSurface } from '../../../../shared/native-chat-session-options'
import { structuredAgentSessionSeedCatalog } from '../../../../shared/structured-agent-session-seed-catalog'
import {
  applyStructuredAgentSessionModelCatalog,
  commitStructuredAgentSessionOption,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionSnapshot,
  type StructuredAgentSessionOptionState
} from '../../../../shared/structured-agent-session-options'
import { nativeChatModelPillLabel } from './native-chat-session-option-labels'
import type { ComposerAutocomplete } from './native-chat-composer-state'
import { useNativeChatComposerKeyDown } from './use-native-chat-composer-keydown'
import { useNativeChatDroidComposerKeys } from './use-native-chat-droid-composer-keys'

const CATALOG: AgentSessionModelCatalogResult = {
  origin: 'probe',
  models: [
    {
      id: 'main-model',
      label: 'Main Model',
      isDefault: false,
      efforts: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' }
      ]
    },
    { id: 'plain-model', label: 'Plain Model', isDefault: false, efforts: [] },
    {
      id: 'deep-model',
      label: 'Deep Model',
      isDefault: false,
      efforts: [
        { value: 'off', label: 'Off' },
        { value: 'medium', label: 'Medium' },
        { value: 'max', label: 'Max' }
      ]
    }
  ],
  fetchedAt: 1_000
}
const MENU_ORDER = ['main-model', 'plain-model', 'deep-model']

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

function coldChat(agent: string): StructuredAgentSessionOptionState {
  const seed = structuredAgentSessionSeedCatalog(agent)
  return applyStructuredAgentSessionModelCatalog(
    createStructuredAgentSessionOptionState(agent, seed),
    seed,
    CATALOG,
    { newLaunch: true }
  )
}

const MENTION_MENU: ComposerAutocomplete = { mode: 'mention', query: 'sr', triggerKey: '@:0' }
const NO_FILES = { files: [], loading: false, failed: false }

const spies = {
  setOption: vi.fn<(id: string, value: string | boolean) => void>(),
  completePickerItem: vi.fn(),
  completeMention: vi.fn(),
  send: vi.fn(),
  interrupt: vi.fn()
}

function Composer(props: {
  agent: string
  isWorking: boolean
  autocomplete?: ComposerAutocomplete
  mentionFiles?: { files: readonly string[]; loading: boolean; failed: boolean }
}): React.JSX.Element {
  const [state, setState] = useState(() => coldChat(props.agent))
  const snapshot = structuredAgentSessionOptionSnapshot(state)
  const surface = useMemo<SessionOptionsSurface>(
    () => ({
      getSnapshot: () => snapshot,
      setOption: async (id, value) => {
        spies.setOption(id, value)
        setState((current) => commitStructuredAgentSessionOption(current, id, String(value)))
        return { snapshot }
      },
      invokeAction: async () => ({ snapshot }),
      subscribe: () => () => {}
    }),
    [snapshot]
  )
  const droidKeys = useNativeChatDroidComposerKeys({
    agent: props.agent,
    snapshot,
    surface,
    isWorking: props.isWorking
  })
  const onKeyDown = useNativeChatComposerKeyDown({
    agent: props.agent,
    droidKeys,
    autocomplete: props.autocomplete ?? NO_MENU,
    mentionFiles: props.mentionFiles ?? NO_FILES,
    completeMention: spies.completeMention,
    activeSuggestion: 0,
    draft: '',
    isComposing: () => false,
    completePickerItem: spies.completePickerItem,
    dispatchPickerCommand: vi.fn(),
    dismissPicker: vi.fn(),
    interrupt: spies.interrupt,
    send: spies.send,
    setActiveSuggestion: vi.fn(),
    setDraft: vi.fn(),
    setCaret: vi.fn()
  })
  const model = snapshot.find((row) => row.id === 'model')
  const effort = snapshot.find((row) => row.id === 'effort')
  return (
    <>
      <div data-testid="composer" onKeyDown={onKeyDown} />
      <output data-testid="model-pill">{model ? nativeChatModelPillLabel(model) : ''}</output>
      <output data-testid="effort-pill">
        {effort?.kind.type === 'select' ? (effort.kind.currentValue ?? '') : 'no effort row'}
      </output>
      <output data-testid="row-ids">{snapshot.map((row) => row.id).join(',')}</output>
    </>
  )
}

/** Presses a key on the composer; true when the composer kept the browser from acting on it. */
function press(init: {
  key: string
  code: string
  ctrlKey?: boolean
  shiftKey?: boolean
}): boolean {
  return !fireEvent.keyDown(screen.getByTestId('composer'), init)
}
const TAB = { key: 'Tab', code: 'Tab' }
const SHIFT_TAB = { key: 'Tab', code: 'Tab', shiftKey: true }
const CTRL_L = { key: 'l', code: 'KeyL', ctrlKey: true }
const CTRL_N = { key: 'n', code: 'KeyN', ctrlKey: true }

const pill = (id: 'model-pill' | 'effort-pill'): string => screen.getByTestId(id).textContent ?? ''

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Ctrl+N on a cold Droid chat that names no default model', () => {
  it('starts with the quiet Model pill, the menu in the listed order and no effort row', () => {
    render(<Composer agent="droid" isWorking={false} />)
    const model = structuredAgentSessionOptionSnapshot(coldChat('droid')).find(
      (row) => row.id === 'model'
    )

    expect(pill('model-pill')).toBe('Model')
    expect(screen.getByTestId('row-ids').textContent).toBe('model,planMode')
    expect(model?.kind).toMatchObject({
      type: 'select',
      choices: MENU_ORDER.map((value) => ({ value }))
    })
    expect(model?.kind).not.toHaveProperty('currentValue')
  })

  it('walks every model in the menu order and the pill follows, then wraps', () => {
    render(<Composer agent="droid" isWorking={false} />)
    const seen: string[] = []

    for (let count = 0; count < MENU_ORDER.length + 1; count++) {
      expect(press(CTRL_N)).toBe(true)
      seen.push(pill('model-pill'))
    }

    expect(spies.setOption.mock.calls.map(([, value]) => value)).toEqual([
      ...MENU_ORDER,
      MENU_ORDER[0]
    ])
    expect(spies.setOption.mock.calls.every(([id]) => id === 'model')).toBe(true)
    expect(seen).toEqual(['Main Model', 'Plain Model', 'Deep Model', 'Main Model'])
  })
})

describe('Tab on a Droid chat', () => {
  it("cycles the current model's efforts in the row's order, and the row follows the model", () => {
    render(<Composer agent="droid" isWorking={false} />)

    press(CTRL_N)
    expect(pill('model-pill')).toBe('Main Model')
    expect(pill('effort-pill')).toBe('')
    const seen: string[] = []
    for (let count = 0; count < 3; count++) {
      expect(press(TAB)).toBe(true)
      seen.push(pill('effort-pill'))
    }
    expect(seen).toEqual(['low', 'high', 'low'])

    press(CTRL_N)
    expect(pill('model-pill')).toBe('Plain Model')
    expect(pill('effort-pill')).toBe('no effort row')
    const sent = spies.setOption.mock.calls.length
    expect(press(TAB)).toBe(false)
    expect(spies.setOption).toHaveBeenCalledTimes(sent)

    press(CTRL_N)
    expect(pill('model-pill')).toBe('Deep Model')
    for (let count = 0; count < 4; count++) {
      press(TAB)
    }
    expect(spies.setOption.mock.calls.map(([id, value]) => `${id}=${String(value)}`)).toEqual([
      'model=main-model',
      'effort=low',
      'effort=high',
      'effort=low',
      'model=plain-model',
      'model=deep-model',
      'effort=off',
      'effort=medium',
      'effort=max',
      'effort=off'
    ])
  })

  it('leaves an open slash menu the Tab, and sets nothing', () => {
    render(<Composer agent="droid" isWorking={false} autocomplete={SLASH_MENU} />)
    press(CTRL_N)
    spies.setOption.mockClear()

    expect(press(TAB)).toBe(true)

    expect(spies.completePickerItem).toHaveBeenCalledWith(COMMAND)
    expect(spies.setOption).not.toHaveBeenCalled()
  })

  it('leaves an open @ menu with files the Tab, and sets nothing', () => {
    render(
      <Composer
        agent="droid"
        isWorking={false}
        autocomplete={MENTION_MENU}
        mentionFiles={{ files: ['src/index.ts'], loading: false, failed: false }}
      />
    )

    expect(press(TAB)).toBe(true)

    expect(spies.completeMention).toHaveBeenCalledWith('src/index.ts')
    expect(spies.setOption).not.toHaveBeenCalled()
  })
})

describe('the four mode keys while a Droid turn runs', () => {
  it.each([
    ['Shift+Tab', SHIFT_TAB],
    ['Ctrl+L', CTRL_L],
    ['Tab', TAB],
    ['Ctrl+N', CTRL_N]
  ])('%s is consumed and changes nothing', (_name, key) => {
    render(<Composer agent="droid" isWorking={true} />)
    const before = ['model-pill', 'effort-pill', 'row-ids'].map(
      (id) => screen.getByTestId(id).textContent
    )

    expect(press(key)).toBe(true)

    expect(spies.setOption).not.toHaveBeenCalled()
    expect(
      ['model-pill', 'effort-pill', 'row-ids'].map((id) => screen.getByTestId(id).textContent)
    ).toEqual(before)
    expect(spies.send).not.toHaveBeenCalled()
    expect(spies.interrupt).not.toHaveBeenCalled()
  })

  it('no longer lets Escape interrupt; only Stop does', () => {
    render(<Composer agent="droid" isWorking={true} />)

    expect(press({ key: 'Escape', code: 'Escape' })).toBe(true)

    expect(spies.interrupt).not.toHaveBeenCalled()
  })

  it('still sends on Enter and leaves Ctrl+C alone', () => {
    render(<Composer agent="droid" isWorking={true} />)

    expect(press({ key: 'Enter', code: 'Enter' })).toBe(true)
    expect(press({ key: 'c', code: 'KeyC', ctrlKey: true })).toBe(false)

    expect(spies.send).toHaveBeenCalledOnce()
    expect(spies.interrupt).not.toHaveBeenCalled()
  })

  it('leaves an open slash menu the Tab', () => {
    render(<Composer agent="droid" isWorking={true} autocomplete={SLASH_MENU} />)

    expect(press(TAB)).toBe(true)

    expect(spies.completePickerItem).toHaveBeenCalledWith(COMMAND)
    expect(spies.setOption).not.toHaveBeenCalled()
  })

  it('leaves an open @ menu with files the Tab', () => {
    render(
      <Composer
        agent="droid"
        isWorking={true}
        autocomplete={MENTION_MENU}
        mentionFiles={{ files: ['src/index.ts'], loading: false, failed: false }}
      />
    )

    expect(press(TAB)).toBe(true)

    expect(spies.completeMention).toHaveBeenCalledWith('src/index.ts')
    expect(spies.setOption).not.toHaveBeenCalled()
  })

  it('works again once the turn ends', () => {
    const view = render(<Composer agent="droid" isWorking={true} />)
    press(CTRL_N)
    press(SHIFT_TAB)
    expect(spies.setOption).not.toHaveBeenCalled()

    view.rerender(<Composer agent="droid" isWorking={false} />)
    press(CTRL_N)
    press(SHIFT_TAB)

    expect(spies.setOption.mock.calls).toEqual([
      ['model', 'main-model'],
      ['planMode', true]
    ])
    expect(pill('model-pill')).toBe('Main Model')
  })
})

describe.each(['claude', 'codex', 'pi', 'grok', 'opencode', 'omp'])(
  '%s: Tab and Ctrl+N stay with the browser',
  (agent) => {
    it.each([false, true])('with a turn running: %s', (isWorking) => {
      render(<Composer agent={agent} isWorking={isWorking} />)

      expect(press(TAB)).toBe(false)
      expect(press(CTRL_N)).toBe(false)
      expect(press(SHIFT_TAB)).toBe(false)
      expect(press(CTRL_L)).toBe(false)

      expect(spies.setOption).not.toHaveBeenCalled()
    })
  }
)
