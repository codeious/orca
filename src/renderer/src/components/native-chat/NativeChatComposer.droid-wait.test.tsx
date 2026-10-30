// @vitest-environment happy-dom

// Droid takes a message mid-turn at once: Enter steers it into the running turn, and Ctrl+Enter
// (literal Ctrl on every OS) asks Droid to answer it after the current reply. Both are sends the
// composer makes now, never a held card; which placement string goes out is the host's business.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as nativeChatAgentProfiles from '../../../../shared/native-chat-agent-profiles'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))
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
vi.mock('../../../../shared/native-chat-agent-profiles', async (importOriginal) => ({
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
import { changePrompt } from './native-chat-prompt-editor.test-support'

const PASS_THROUGH = { handled: false, accepted: false, error: null }
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64)'

function transport(): NativeChatStructuredComposerTransport {
  return {
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

function renderComposer(args: {
  agent: 'droid' | 'claude'
  isWorking: boolean
  structured?: NativeChatStructuredComposerTransport
  steerQueued?: () => boolean
}) {
  paneCounter += 1
  const structured = args.structured ?? transport()
  render(
    <NativeChatComposer
      terminalTabId={`tab-${paneCounter}`}
      paneKey={`tab-${paneCounter}:structured`}
      targetPtyId={null}
      agent={args.agent}
      isWorking={args.isWorking}
      structuredTransport={structured}
      {...(args.steerQueued ? { steerQueued: args.steerQueued } : {})}
    />
  )
  return { structured, input: screen.getByRole('textbox') }
}

function press(input: HTMLElement, init: { ctrlKey?: boolean; metaKey?: boolean } = {}): void {
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, ...init })
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      git: { discoverCommitMessageModels: vi.fn().mockResolvedValue({ success: false }) },
      pty: { getMainBufferSnapshot: vi.fn().mockResolvedValue(null) }
    }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe.each([
  ['while a turn runs', true],
  ['when idle', false]
])('Droid composer %s', (_when, isWorking) => {
  it.each([
    ['macOS', MAC],
    ['Windows', WINDOWS],
    ['Linux', LINUX]
  ])('sends on Enter, and asks to answer after the reply on Ctrl+Enter, on %s', async (_os, ua) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
    const { structured, input } = renderComposer({ agent: 'droid', isWorking })

    changePrompt(input, 'steer this')
    press(input)
    await vi.waitFor(() => expect(structured.send).toHaveBeenCalledTimes(1))
    expect(structured.send).toHaveBeenLastCalledWith('steer this', [])

    changePrompt(input, 'then answer this')
    press(input, { ctrlKey: true })
    await vi.waitFor(() => expect(structured.send).toHaveBeenCalledTimes(2))
    expect(structured.send).toHaveBeenLastCalledWith('then answer this', [], { afterReply: true })
  })

  it('does not send an empty composer on Ctrl+Enter', async () => {
    const { structured, input } = renderComposer({ agent: 'droid', isWorking })

    press(input, { ctrlKey: true })
    await Promise.resolve()
    expect(structured.send).not.toHaveBeenCalled()
    expect(structured.dispatchCommand).not.toHaveBeenCalled()
  })
})

describe('Droid composer next to the queue steer chord', () => {
  it('keeps Cmd+Enter on a Mac an ordinary send, never the wait key', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC)
    const { structured, input } = renderComposer({ agent: 'droid', isWorking: true })

    changePrompt(input, 'plain')
    press(input, { metaKey: true })
    await vi.waitFor(() => expect(structured.send).toHaveBeenCalledTimes(1))
    expect(structured.send).toHaveBeenLastCalledWith('plain', [])
  })

  it('still steers a waiting card from an empty composer off a Mac, and waits with text', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(LINUX)
    const steerQueued = vi.fn(() => true)
    const { structured, input } = renderComposer({ agent: 'droid', isWorking: true, steerQueued })

    press(input, { ctrlKey: true })
    expect(steerQueued).toHaveBeenCalledTimes(1)
    expect(structured.send).not.toHaveBeenCalled()

    changePrompt(input, 'then answer this')
    press(input, { ctrlKey: true })
    await vi.waitFor(() => expect(structured.send).toHaveBeenCalledTimes(1))
    expect(structured.send).toHaveBeenLastCalledWith('then answer this', [], { afterReply: true })
    expect(steerQueued).toHaveBeenCalledTimes(1)
  })
})

describe('every other agent', () => {
  it.each([
    ['macOS', MAC],
    ['Linux', LINUX]
  ])('sends Ctrl+Enter as an ordinary message on %s', async (_os, ua) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
    const { structured, input } = renderComposer({ agent: 'claude', isWorking: true })

    changePrompt(input, 'hello')
    press(input, { ctrlKey: true })
    await vi.waitFor(() => expect(structured.send).toHaveBeenCalledTimes(1))
    expect(structured.send).toHaveBeenLastCalledWith('hello', [])
  })

  it('keeps the empty-composer chord steering a queued card off a Mac', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(LINUX)
    const steerQueued = vi.fn(() => true)
    const { structured, input } = renderComposer({ agent: 'claude', isWorking: true, steerQueued })

    press(input, { ctrlKey: true })
    expect(steerQueued).toHaveBeenCalledTimes(1)
    expect(structured.send).not.toHaveBeenCalled()
  })
})
