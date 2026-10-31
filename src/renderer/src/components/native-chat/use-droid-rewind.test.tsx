// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  ConfirmationDialogContext,
  type ConfirmationDialogContextValue
} from '@/components/confirmation-dialog-context'
import {
  agentJournalItemKey,
  agentJournalSubmissionKey
} from '../../../../shared/agent-session-journal-item-key'
import type { DroidHostCommandResult } from '../../../../shared/droid-host-command'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import type { AgentType } from '../../../../shared/agent-status-types'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  switchSession: vi.fn(),
  toast: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))
vi.mock('@/lib/droid-chat-session-switch', () => ({ switchDroidChatSession: mocks.switchSession }))
vi.mock('sonner', () => ({ toast: Object.assign(mocks.toast, { error: mocks.toastError }) }))

import { useDroidRewind } from './use-droid-rewind'

const TAB = 'agent-session:droid-old'
const SESSION = 'session-old'
const TARGET = { kind: 'environment', environmentId: 'env-1' } as const

const SNAPSHOT: SessionOptionDescriptor[] = [
  {
    id: 'model',
    label: 'Model',
    kind: { type: 'select', currentValue: 'claude-haiku-5-5', choices: [] },
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true
  }
]
const KEPT = { model: 'claude-haiku-5-5' }

type Args = Parameters<typeof useDroidRewind>[0]

const droidKey = (messageId: string) => agentJournalItemKey({ provider: 'droid', messageId })
const lineKey = agentJournalItemKey({
  provider: 'legacy',
  agent: 'droid',
  sessionId: 'adopted-1',
  recordId: '#4'
})

function row(id: string, role: NativeChatMessage['role'], extra: Partial<NativeChatMessage> = {}) {
  const message: NativeChatMessage = {
    id,
    role,
    blocks: [{ type: 'text', text: 'ok' }],
    timestamp: null,
    source: 'transcript',
    ...extra
  }
  return message
}

const FIRST = droidKey('msg-1')
const SECOND = droidKey('msg-2')
const IDLE: Args['controller'] = {
  messages: [
    row(FIRST, 'user'),
    row(droidKey('msg-1-reply'), 'assistant'),
    row(SECOND, 'user'),
    row(droidKey('msg-2-reply'), 'assistant')
  ],
  submissions: [],
  optionSnapshot: SNAPSHOT,
  optionSurface: undefined,
  isWorking: false,
  sendOut: false,
  prompts: [],
  backgroundTasks: { isMonitoring: false },
  queuedMessages: { cards: [] }
}

const REWOUND: DroidHostCommandResult = {
  name: 'rewind',
  newSessionId: 'droid-session-rewound',
  restoredCount: 2,
  deletedCount: 1,
  notRestoredCount: 0
}

const BUSY_WORDS = 'Wait for Droid to finish before rewinding.'
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

let confirm: Mock<ConfirmationDialogContextValue>

function mount(
  controller: Partial<Args['controller']> = {},
  agent: AgentType = 'droid',
  withDialog = true
) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    withDialog
      ? createElement(ConfirmationDialogContext.Provider, { value: confirm }, children)
      : createElement('div', null, children)
  return renderHook(
    (next: Partial<Args['controller']>) =>
      useDroidRewind({
        props: { tabId: TAB, sessionId: SESSION, target: TARGET, agent },
        controller: { ...IDLE, ...next }
      }),
    { initialProps: controller, wrapper }
  )
}

function rewindCalls() {
  return mocks.call.mock.calls.filter(([, method]) => method === 'agentSession.droidCommand')
}

beforeEach(() => {
  vi.clearAllMocks()
  confirm = vi.fn<ConfirmationDialogContextValue>(async () => true)
  mocks.call.mockResolvedValue(REWOUND)
  mocks.switchSession.mockReturnValue({
    settlement: Promise.resolve({ kind: 'structured', sessionId: 'tab-new' })
  })
})

describe('the rewind of a chat that is not Droid', () => {
  it.each(['claude', 'codex', 'pi', 'omp', 'grok', 'opencode'] as const)(
    'is none for %s, which keeps its own',
    (agent) => {
      expect(mount({}, agent).result.current).toBeUndefined()
    }
  )
})

describe('where "Rewind to here" is offered in a Droid chat', () => {
  it('is a surface that is open while Droid is idle', () => {
    expect(mount().result.current?.surface.disabledReason).toBeNull()
  })

  it('names only the sent messages Droid can rewind to', () => {
    const { result } = mount({
      messages: [
        row(FIRST, 'user'),
        row(droidKey('msg-1-reply'), 'assistant'),
        row(lineKey, 'user'),
        row(agentJournalSubmissionKey('never-accepted'), 'user')
      ]
    })

    expect([...(result.current?.surface.eligibleItemIds ?? [])]).toEqual([FIRST])
  })

  it('follows a send Orca placed to the row Droid accepted it as', () => {
    const placed = agentJournalSubmissionKey('client-1')
    const { result } = mount({
      messages: [row(placed, 'user')],
      submissions: [
        { clientMessageId: 'client-1', dispatchState: 'accepted', providerItemId: SECOND }
      ]
    })

    expect([...(result.current?.surface.eligibleItemIds ?? [])]).toEqual([placed])
  })

  it.each([
    ['a turn is running', { isWorking: true }],
    ['a send is out', { sendOut: true }],
    ['a prompt waits for an answer', { prompts: [{}] }],
    ['a background task is monitored', { backgroundTasks: { isMonitoring: true } }],
    ['a message waits in the queue', { queuedMessages: { cards: [{}] } }]
  ] as const)('says to wait while %s', (_label, busy) => {
    expect(mount(busy).result.current?.surface.disabledReason).toBe(BUSY_WORDS)
  })
})

describe('Rewind to here on a message', () => {
  it('asks once, then rewinds through the Droid child and moves the tab in place to the new session', async () => {
    const { result } = mount()

    await result.current?.surface.request(FIRST, confirm)

    expect(confirm).toHaveBeenCalledOnce()
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(TARGET, 'agentSession.droidCommand', {
      sessionId: SESSION,
      command: { name: 'rewind', itemId: FIRST }
    })
    expect(mocks.switchSession).toHaveBeenCalledExactlyOnceWith({
      fromTabId: TAB,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: 'droid-session-rewound', settings: KEPT }
    })
    await flush()
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
      'Rewound the conversation. The earlier session stays in Session History.'
    )
  })

  it('never calls the rewind that returns the message to the composer', async () => {
    const { result } = mount()

    await result.current?.surface.request(FIRST, confirm)

    expect(mocks.call.mock.calls.map(([, method]) => method)).toEqual(['agentSession.droidCommand'])
  })

  it('does not say that file changes are kept, because Droid puts them back', async () => {
    const { result } = mount()

    await result.current?.surface.request(FIRST, confirm)

    const [options] = confirm.mock.calls[0] ?? []
    expect(options).toMatchObject({
      title: 'Rewind to here?',
      confirmLabel: 'Rewind',
      confirmVariant: 'destructive'
    })
    expect(options?.description).toMatch(/new session/i)
    expect(options?.description).toMatch(/Session History/)
    expect(options?.description).not.toMatch(/kept|keep/i)
  })

  it('counts the files Droid could not put back', async () => {
    mocks.call.mockResolvedValue({ ...REWOUND, notRestoredCount: 3 })
    const { result } = mount()

    await result.current?.surface.request(FIRST, confirm)
    await flush()

    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
      'Rewound the conversation. Files Droid could not put back: 3. The earlier session stays in Session History.'
    )
  })

  it('does nothing when the person cancels', async () => {
    confirm.mockResolvedValue(false)
    const { result } = mount()

    await result.current?.surface.request(FIRST, confirm)

    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.switchSession).not.toHaveBeenCalled()
  })

  it('says what Droid said when it cannot rewind, keeps the tab, and can be tried again', async () => {
    mocks.call.mockRejectedValueOnce(
      new Error('Droid could not say which files the rewind changes. Nothing was rewound.')
    )
    const { result } = mount()

    await result.current?.surface.request(FIRST, confirm)

    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      'Droid could not say which files the rewind changes. Nothing was rewound.'
    )
    expect(mocks.switchSession).not.toHaveBeenCalled()

    await result.current?.surface.request(FIRST, confirm)
    expect(mocks.switchSession).toHaveBeenCalledOnce()
  })

  it('tells the person to update an older server that does not know the command', async () => {
    mocks.call.mockRejectedValueOnce(
      Object.assign(new Error('Invalid params'), { code: 'invalid_argument' })
    )
    const { result } = mount()

    await result.current?.surface.request(FIRST, confirm)

    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      'Droid chat commands need a newer Orca server. Update the server and try again.'
    )
  })

  it('says, once, that the new session could not be opened when nothing else did', async () => {
    mocks.switchSession.mockReturnValue({
      settlement: Promise.resolve({ kind: 'failed', notified: false })
    })
    const { result } = mount()

    await result.current?.surface.request(FIRST, confirm)
    await flush()

    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      'Droid rewound the conversation into a new session, but Orca could not open it. The earlier session stays in Session History.'
    )
  })

  it('stays quiet when the launch already told the person', async () => {
    mocks.switchSession.mockReturnValue({
      settlement: Promise.resolve({ kind: 'failed', notified: true })
    })
    const { result } = mount()

    await result.current?.surface.request(FIRST, confirm)
    await flush()

    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('says so when the switch cannot start at all', async () => {
    mocks.switchSession.mockImplementation(() => {
      throw new Error('not a Droid chat')
    })
    const { result } = mount()

    await result.current?.surface.request(FIRST, confirm)

    expect(mocks.toastError).toHaveBeenCalledOnce()
  })

  it('does not ask while Droid works', async () => {
    const { result } = mount({ isWorking: true })

    await result.current?.surface.request(FIRST, confirm)

    expect(confirm).not.toHaveBeenCalled()
    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(BUSY_WORDS)
  })

  it('does not rewind if a turn started while the dialog was open', async () => {
    let answer: (confirmed: boolean) => void = () => undefined
    confirm.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result, rerender } = mount()

    const asked = result.current?.surface.request(FIRST, confirm)
    rerender({ isWorking: true })
    answer(true)
    await asked

    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(BUSY_WORDS)
  })

  it('takes a second request as busy while the first still runs', async () => {
    let finish: (result: DroidHostCommandResult) => void = () => undefined
    mocks.call.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { result } = mount()

    const first = result.current?.surface.request(FIRST, confirm)
    await flush()
    await result.current?.surface.request(SECOND, confirm)
    finish(REWOUND)
    await first
    await flush()

    expect(confirm).toHaveBeenCalledOnce()
    expect(rewindCalls()).toHaveLength(1)
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      'Droid is already rewinding this conversation.'
    )
  })
})

describe('/rewind-conversation and Esc three times in a Droid chat', () => {
  it('rewinds to the latest message sent, after one confirmation', async () => {
    const { result } = mount()

    expect(await result.current?.open()).toEqual({ accepted: true, error: null })

    expect(confirm).toHaveBeenCalledOnce()
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(TARGET, 'agentSession.droidCommand', {
      sessionId: SESSION,
      command: { name: 'rewind', itemId: SECOND }
    })
    expect(mocks.switchSession).toHaveBeenCalledExactlyOnceWith({
      fromTabId: TAB,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: 'droid-session-rewound', settings: KEPT }
    })
  })

  it('skips a message that is queued or was a command, and one Droid cannot name', async () => {
    const { result } = mount({
      messages: [
        row(FIRST, 'user'),
        row(SECOND, 'user', { queued: true }),
        row(droidKey('msg-3'), 'user', { command: { name: 'compact' } }),
        row(lineKey, 'user')
      ]
    })

    await result.current?.open()

    expect(mocks.call).toHaveBeenCalledExactlyOnceWith(TARGET, 'agentSession.droidCommand', {
      sessionId: SESSION,
      command: { name: 'rewind', itemId: FIRST }
    })
  })

  it('does not rewind when the person cancels', async () => {
    confirm.mockResolvedValue(false)
    const { result } = mount()

    expect(await result.current?.open()).toEqual({ accepted: false, error: null })

    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.switchSession).not.toHaveBeenCalled()
  })

  it('says there is nothing to rewind to, without asking', async () => {
    const { result } = mount({ messages: [row(droidKey('reply'), 'assistant')] })

    expect(await result.current?.open()).toEqual({
      accepted: false,
      error: 'There is no message to rewind to.'
    })

    expect(confirm).not.toHaveBeenCalled()
  })

  it('says to wait while Droid works, without asking', async () => {
    const { result } = mount({ isWorking: true })

    expect(await result.current?.open()).toEqual({ accepted: false, error: BUSY_WORDS })

    expect(confirm).not.toHaveBeenCalled()
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it("says what Droid said when it cannot rewind, in the command's own outcome", async () => {
    mocks.call.mockRejectedValueOnce(new Error('Droid has no record of this message to rewind to.'))
    const { result } = mount()

    expect(await result.current?.open()).toEqual({
      accepted: false,
      error: 'Droid has no record of this message to rewind to.'
    })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('says the chat cannot rewind where no confirmation can be asked', async () => {
    const { result } = mount({}, 'droid', false)

    expect(await result.current?.open()).toEqual({
      accepted: false,
      error: 'This chat cannot rewind.'
    })

    expect(mocks.call).not.toHaveBeenCalled()
  })
})
