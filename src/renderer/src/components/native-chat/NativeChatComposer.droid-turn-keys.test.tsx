// @vitest-environment happy-dom

// Every agent but Droid keeps today's keys: Esc interrupts and Ctrl+C is the browser's.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentType } from '../../../../shared/agent-status-types'
import type * as nativeChatAgentProfiles from '../../../../shared/native-chat/native-chat-agent-profiles'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import { NativeChatRewindContext } from './native-chat-rewind-context'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'

vi.mock('./NativeChatComposerActions', () => ({
  NativeChatComposerActions: () => <div data-testid="composer-actions" />
}))
vi.mock('./NativeChatAutocompleteMenus', () => ({
  NativeChatMentionMenu: () => null,
  NativeChatPickerMenu: () => null
}))
vi.mock('../../store', () => {
  const state = {
    dictationState: 'idle',
    settings: { voice: { enabled: false }, nativeChatSessionOptions: {} },
    agentStatusByPaneKey: {},
    updateSettings: vi.fn(),
    clearNativeChatLaunchDraft: vi.fn(),
    markNativeChatLaunchDraftAdopted: vi.fn()
  }
  const useAppStore = (selector: (value: typeof state) => unknown): unknown => selector(state)
  useAppStore.getState = () => state
  return { useAppStore }
})
vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  isRemoteRuntimePtyId: () => false,
  sendRuntimePtyInput: vi.fn()
}))
vi.mock('./native-chat-runtime-send', () => ({
  sendNativeChatMessage: vi.fn(),
  sendNativeChatTypedCommand: vi.fn(),
  sendNativeChatMessageVerified: vi.fn(),
  typeNativeChatCommand: vi.fn(),
  submitNativeChatPrompt: vi.fn()
}))
vi.mock('./native-chat-runtime-image-send', () => ({
  sendNativeChatMessageWithImageAttachments: vi.fn()
}))
vi.mock('./claude-model-switch-confirmation', () => ({
  createClaudeModelSwitchConfirmationObserver: vi.fn()
}))
vi.mock('../../../../shared/native-chat/native-chat-agent-profiles', async (importOriginal) => ({
  ...(await importOriginal<typeof nativeChatAgentProfiles>()),
  getVerifiedNativeChatCommands: () => []
}))
vi.mock('@/lib/native-chat-telemetry', () => ({
  emitNativeChatMessageSent: vi.fn(),
  emitNativeChatPickerItemAccepted: vi.fn(),
  emitNativeChatPickerOpened: vi.fn(),
  emitNativeChatSendClassified: vi.fn()
}))
vi.mock('./use-native-chat-skills', () => ({
  useNativeChatSkills: () => ({ status: 'ready', skills: [], error: null, retry: () => {} })
}))
vi.mock('../dictation/dictation-control-events', () => ({
  dispatchDictationControl: vi.fn()
}))

import { NativeChatComposer } from './NativeChatComposer'
import { NON_DROID_AGENTS } from '../../../../shared/non-droid-composer-key-agents.test-fixture'
import { changePrompt, promptEditor, promptValue } from './native-chat-prompt-editor.test-support'

const PASS_THROUGH = { handled: false, accepted: false, error: null }
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64)'

const CTRL_C = { key: 'c', code: 'KeyC', keyCode: 67, ctrlKey: true }
const ESCAPE = { key: 'Escape', code: 'Escape', keyCode: 27 }
const ENTER = { key: 'Enter', code: 'Enter', keyCode: 13 }
const CTRL_ENTER = { ...ENTER, ctrlKey: true }

function transport(): NativeChatStructuredComposerTransport {
  return {
    capturePresentation: () => () => true,
    send: vi.fn(() => true),
    dispatchCommand: vi.fn(async () => PASS_THROUGH),
    optionsSurface: {
      getSnapshot: () => [],
      setOption: vi.fn(),
      invokeAction: vi.fn(),
      subscribe: () => () => {}
    },
    optionSnapshot: [],
    onError: vi.fn(),
    runtime: 'remote',
    sessionId: 'session-test',
    runtimeEnvironmentId: null
  }
}

let paneCounter = 0
const writeClipboardText = vi.fn()
const confirm = async () => false

function rewindSurface(openRewind: (() => void) | undefined) {
  return openRewind
    ? {
        disabledReason: null,
        eligibleItemIds: new Set(['latest-user-turn']),
        request: async () => {
          openRewind()
        }
      }
    : undefined
}

function renderComposer(args: { agent: AgentType; isWorking: boolean; openRewind?: () => void }) {
  paneCounter += 1
  const structured = transport()
  const onStop = vi.fn()
  const rewind = rewindSurface(args.openRewind)
  const element = (isWorking: boolean) => (
    <ConfirmationDialogContext.Provider value={confirm}>
      <NativeChatRewindContext.Provider value={rewind}>
        <NativeChatComposer
          terminalTabId={`tab-${paneCounter}`}
          paneKey={`tab-${paneCounter}:structured`}
          targetPtyId={null}
          agent={args.agent}
          isWorking={isWorking}
          onStop={onStop}
          structuredTransport={structured}
        />
      </NativeChatRewindContext.Provider>
    </ConfirmationDialogContext.Provider>
  )
  const view = render(element(args.isWorking))
  return {
    structured,
    onStop,
    input: screen.getByRole('textbox'),
    setWorking: (isWorking: boolean) => view.rerender(element(isWorking))
  }
}

/** Presses a key and says whether the composer kept the browser from acting on it. */
function press(target: Element, init: Record<string, unknown>): boolean {
  return !fireEvent.keyDown(target, init)
}

function select(input: HTMLElement, from: number, to: number): void {
  promptEditor(input).commands.setTextSelection({ from, to })
}

beforeEach(() => {
  writeClipboardText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      git: { discoverCommitMessageModels: vi.fn().mockResolvedValue({ success: false }) },
      pty: { getMainBufferSnapshot: vi.fn().mockResolvedValue(null) },
      ui: { writeClipboardText, setDroidComposerFocused: vi.fn() }
    }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe.each([
  ['macOS', MAC],
  ['Windows', WINDOWS],
  ['Linux', LINUX]
])('Droid composer Ctrl+C on %s', (_os, ua) => {
  beforeEach(() => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  })

  it('stops a running turn once, and a second press sends nothing', () => {
    const { onStop, input } = renderComposer({ agent: 'droid', isWorking: true })

    expect(press(input, CTRL_C)).toBe(true)
    expect(onStop).toHaveBeenCalledTimes(1)

    expect(press(input, CTRL_C)).toBe(true)
    expect(press(input, CTRL_C)).toBe(true)
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(writeClipboardText).not.toHaveBeenCalled()
  })

  it('stops the next turn once the first has ended', () => {
    const { onStop, input, setWorking } = renderComposer({ agent: 'droid', isWorking: true })
    press(input, CTRL_C)
    setWorking(false)
    press(input, CTRL_C)
    expect(onStop).toHaveBeenCalledTimes(1)

    setWorking(true)
    press(input, CTRL_C)
    press(input, CTRL_C)
    expect(onStop).toHaveBeenCalledTimes(2)
  })

  it('does nothing when idle with nothing selected', () => {
    const { onStop, structured, input } = renderComposer({ agent: 'droid', isWorking: false })

    press(input, CTRL_C)
    expect(onStop).not.toHaveBeenCalled()
    expect(structured.send).not.toHaveBeenCalled()
    expect(structured.dispatchCommand).not.toHaveBeenCalled()
    expect(writeClipboardText).not.toHaveBeenCalled()
  })

  it('copies a selection and keeps the turn running', () => {
    const { onStop, input } = renderComposer({ agent: 'droid', isWorking: true })
    changePrompt(input, 'copy-me later')
    select(input, 1, 8)

    expect(press(input, CTRL_C)).toBe(true)
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith('copy-me')
    expect(onStop).not.toHaveBeenCalled()
    expect(promptValue(input)).toBe('copy-me later')

    // The copy did not spend the stop: with the selection gone, the next press stops the turn.
    select(input, 4, 4)
    press(input, CTRL_C)
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(writeClipboardText).toHaveBeenCalledTimes(1)
  })

  it('copies a selection when idle too', () => {
    const { onStop, input } = renderComposer({ agent: 'droid', isWorking: false })
    changePrompt(input, 'copy-me')
    select(input, 1, 5)

    press(input, CTRL_C)
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith('copy')
    expect(onStop).not.toHaveBeenCalled()
  })
})

describe('Droid composer Esc', () => {
  it.each([true, false])('clears the draft and never stops the turn (running: %s)', (isWorking) => {
    const { onStop, structured, input } = renderComposer({ agent: 'droid', isWorking })
    changePrompt(input, 'discard-me')

    expect(press(input, ESCAPE)).toBe(true)
    expect(promptValue(input)).toBe('')

    // Nothing is left to clear: a second and third press still stop nothing and send nothing.
    press(input, ESCAPE)
    press(input, ESCAPE)
    expect(onStop).not.toHaveBeenCalled()
    expect(structured.send).not.toHaveBeenCalled()
  })

  it('leaves the turn running when a press clears the draft and then Ctrl+C stops it once', () => {
    const { onStop, input } = renderComposer({ agent: 'droid', isWorking: true })
    changePrompt(input, 'discard-me')

    press(input, ESCAPE)
    expect(onStop).not.toHaveBeenCalled()
    press(input, CTRL_C)
    press(input, CTRL_C)
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})

describe('Droid composer Esc three times', () => {
  const START = 1_000_000

  /** One press, then one more after each gap, on a clock the test sets. */
  function escapes(input: Element, gaps: readonly number[]): void {
    let now = START
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    press(input, ESCAPE)
    for (const gap of gaps) {
      now += gap
      press(input, ESCAPE)
    }
  }

  it.each([
    ['100 ms apart', [100, 100]],
    ['exactly 175 ms apart', [175, 175]]
  ])('opens rewind once when three presses come %s on an empty composer', (_label, gaps) => {
    const openRewind = vi.fn()
    const { onStop, structured, input } = renderComposer({
      agent: 'droid',
      isWorking: false,
      openRewind
    })

    escapes(input, gaps)

    expect(openRewind).toHaveBeenCalledOnce()
    expect(onStop).not.toHaveBeenCalled()
    expect(structured.send).not.toHaveBeenCalled()
  })

  it('counts the next three afresh, so six quick presses open it twice and five once', () => {
    const six = vi.fn()
    escapes(
      renderComposer({ agent: 'droid', isWorking: false, openRewind: six }).input,
      [100, 100, 100, 100, 100]
    )
    expect(six).toHaveBeenCalledTimes(2)
    cleanup()

    const five = vi.fn()
    escapes(
      renderComposer({ agent: 'droid', isWorking: false, openRewind: five }).input,
      [100, 100, 100, 100]
    )
    expect(five).toHaveBeenCalledOnce()
  })

  it.each([
    ['one press', []],
    ['two presses', [100]],
    ['a 200 ms gap before the third', [100, 200]],
    ['a 200 ms gap before the second', [200, 100]],
    ['a 300 ms gap', [300, 300]]
  ])('does not open rewind after %s', (_label, gaps) => {
    const openRewind = vi.fn()
    const { input } = renderComposer({ agent: 'droid', isWorking: false, openRewind })

    escapes(input, gaps)

    expect(openRewind).not.toHaveBeenCalled()
  })

  it('does not count the press that cleared the draft', () => {
    const openRewind = vi.fn()
    const { input } = renderComposer({ agent: 'droid', isWorking: false, openRewind })
    changePrompt(input, 'discard-me')

    escapes(input, [100, 100])

    expect(promptValue(input)).toBe('')
    expect(openRewind).not.toHaveBeenCalled()
  })

  it('does nothing with three presses when the chat offers no rewind', () => {
    const { input, onStop } = renderComposer({ agent: 'droid', isWorking: false })

    escapes(input, [100, 100])

    expect(onStop).not.toHaveBeenCalled()
  })
})

describe('a Droid composer that does not have the key', () => {
  it.each([
    ['Enter', ENTER],
    ['Ctrl+Enter', CTRL_ENTER],
    ['Ctrl+C', CTRL_C],
    ['Esc', ESCAPE]
  ])('is left alone by %s pressed elsewhere', (_name, init) => {
    const { onStop, structured, input } = renderComposer({ agent: 'droid', isWorking: true })
    changePrompt(input, 'keep-me')
    select(input, 1, 5)

    fireEvent.keyDown(document.body, init)
    fireEvent.keyDown(screen.getByTestId('composer-actions'), init)

    expect(onStop).not.toHaveBeenCalled()
    expect(structured.send).not.toHaveBeenCalled()
    expect(writeClipboardText).not.toHaveBeenCalled()
    expect(promptValue(input)).toBe('keep-me')
  })
})

describe.each(NON_DROID_AGENTS)('the %s composer keeps its own Esc and Ctrl+C', (agent) => {
  it('stops a running turn on Esc and keeps the draft when idle', () => {
    const running = renderComposer({ agent, isWorking: true })
    changePrompt(running.input, 'keep-me')
    expect(press(running.input, ESCAPE)).toBe(true)
    expect(running.onStop).toHaveBeenCalledTimes(1)
    expect(promptValue(running.input)).toBe('keep-me')
    cleanup()

    const idle = renderComposer({ agent, isWorking: false })
    changePrompt(idle.input, 'keep-me')
    press(idle.input, ESCAPE)
    expect(idle.onStop).not.toHaveBeenCalled()
    expect(promptValue(idle.input)).toBe('keep-me')
  })

  it('never opens rewind on three quick Esc presses', () => {
    const openRewind = vi.fn()
    const { input } = renderComposer({ agent, isWorking: false, openRewind })

    press(input, ESCAPE)
    press(input, ESCAPE)
    press(input, ESCAPE)

    expect(openRewind).not.toHaveBeenCalled()
  })

  it('leaves Ctrl+C to the browser: no stop, no copy of its own, key not claimed', () => {
    const { onStop, input } = renderComposer({ agent, isWorking: true })
    changePrompt(input, 'copy-me')
    select(input, 1, 5)

    expect(press(input, CTRL_C)).toBe(false)
    expect(onStop).not.toHaveBeenCalled()
    expect(writeClipboardText).not.toHaveBeenCalled()
    select(input, 3, 3)
    expect(press(input, CTRL_C)).toBe(false)
    expect(onStop).not.toHaveBeenCalled()
  })

  it('sends on Enter mid-turn with no Droid placement', async () => {
    const { structured, input } = renderComposer({ agent, isWorking: true })
    changePrompt(input, 'hello')
    press(input, ENTER)
    await vi.waitFor(() => expect(structured.send).toHaveBeenCalledTimes(1))
    expect(structured.send).toHaveBeenLastCalledWith('hello', [])
  })
})
