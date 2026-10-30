// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import type { AgentJournalSpecHandoff } from '../../../../shared/agent-session-journal-spec-handoff'
import type { StructuredAgentLaunchSettlement } from '@/lib/structured-agent-launch-settlement'

const mocks = vi.hoisted(() => ({
  switchSession: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/lib/droid-chat-session-switch', () => ({ switchDroidChatSession: mocks.switchSession }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import { useDroidSpecHandoff } from './use-droid-spec-handoff'

const TAB = 'agent-session:droid-old'
const NEW_SESSION = '00000000-0000-4000-8000-000000000007'
const PROMPT = 'Implement the following plan:\n\n1. Write plan-probe.txt.\n'

function handoff(
  id: string,
  extra: Partial<AgentJournalSpecHandoff> = {}
): AgentJournalSpecHandoff {
  return { newSessionId: NEW_SESSION, initialPrompt: PROMPT, specHandoffId: id, ...extra }
}

function statusRow(
  sequence: number,
  specHandoff?: AgentJournalSpecHandoff
): AgentJournalRenderItem {
  return {
    itemId: `status-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence,
    body: {
      kind: 'status',
      text: specHandoff ? 'Continuing in a new Droid session' : 'Turn started',
      ...(specHandoff ? { specHandoff } : {})
    }
  }
}

type HookArgs = Parameters<typeof useDroidSpecHandoff>[0]

function mount(initial: Partial<HookArgs>) {
  return renderHook((args: HookArgs) => useDroidSpecHandoff(args), {
    initialProps: { tabId: TAB, agent: 'droid', status: 'ready', journalItems: [], ...initial }
  })
}

function settles(settled: StructuredAgentLaunchSettlement): void {
  mocks.switchSession.mockReturnValue({ settlement: Promise.resolve(settled) })
}

beforeEach(() => {
  vi.clearAllMocks()
  settles({ kind: 'structured', sessionId: 'droid-new' })
})

describe('opening the session a Spec plan was handed to', () => {
  it('does not switch for a handoff already in the history the chat first loaded', () => {
    const view = mount({ journalItems: [statusRow(1, handoff('a1'))] })
    view.rerender({
      tabId: TAB,
      agent: 'droid',
      status: 'ready',
      journalItems: [statusRow(1, handoff('a1')), statusRow(2)]
    })

    expect(mocks.switchSession).not.toHaveBeenCalled()
  })

  it('does not switch while the history is still loading, even when it holds a handoff', () => {
    const view = mount({ status: 'loading', journalItems: [statusRow(1, handoff('a1'))] })
    view.rerender({
      tabId: TAB,
      agent: 'droid',
      status: 'ready',
      journalItems: [statusRow(1, handoff('a1'))]
    })

    expect(mocks.switchSession).not.toHaveBeenCalled()
  })

  it('switches in place once for a handoff that arrives after the first load', () => {
    const view = mount({ journalItems: [statusRow(1)] })
    const arrived = [statusRow(1), statusRow(2, handoff('a2'))]

    view.rerender({ tabId: TAB, agent: 'droid', status: 'ready', journalItems: arrived })
    view.rerender({ tabId: TAB, agent: 'droid', status: 'ready', journalItems: [...arrived] })

    expect(mocks.switchSession).toHaveBeenCalledTimes(1)
    expect(mocks.switchSession).toHaveBeenCalledWith({
      fromTabId: TAB,
      placement: 'replace',
      target: { kind: 'existing', droidSessionId: NEW_SESSION, settings: { spec: false } },
      firstMessage: PROMPT
    })
  })

  it('carries the autonomy level the chosen option named, and the whole prompt', () => {
    const long = `Implement the following plan:\n\n${'1. Step.\n'.repeat(4000)}`
    const view = mount({})

    view.rerender({
      tabId: TAB,
      agent: 'droid',
      status: 'ready',
      journalItems: [statusRow(1, handoff('a3', { autonomyLevel: 'high', initialPrompt: long }))]
    })

    expect(mocks.switchSession).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ settings: { spec: false, autonomyLevel: 'high' } }),
        firstMessage: long
      })
    )
  })

  it('switches again for a later handoff with a different id', () => {
    const view = mount({})
    view.rerender({
      tabId: TAB,
      agent: 'droid',
      status: 'ready',
      journalItems: [statusRow(1, handoff('a4'))]
    })
    view.rerender({
      tabId: TAB,
      agent: 'droid',
      status: 'ready',
      journalItems: [statusRow(1, handoff('a4')), statusRow(2, handoff('a5'))]
    })

    expect(mocks.switchSession).toHaveBeenCalledTimes(2)
  })

  it('leaves a chat of another agent alone', () => {
    const view = mount({ agent: 'claude' })
    view.rerender({
      tabId: TAB,
      agent: 'claude',
      status: 'ready',
      journalItems: [statusRow(1, handoff('a6'))]
    })

    expect(mocks.switchSession).not.toHaveBeenCalled()
  })

  it('tells the user, and keeps the planning chat, when the new session does not open', async () => {
    settles({ kind: 'failed', error: new Error('load failed') })
    const view = mount({})
    view.rerender({
      tabId: TAB,
      agent: 'droid',
      status: 'ready',
      journalItems: [statusRow(1, handoff('a7'))]
    })

    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
  })

  it.each([
    [
      'a failure the launch already reported',
      { kind: 'failed', error: new Error('x'), notified: true }
    ],
    ['a chat whose visibility is not yet known', { kind: 'visibility-unknown', sessionId: 'd' }]
  ] as const)('adds no message of its own for %s', async (_name, settled) => {
    settles(settled)
    const view = mount({})
    view.rerender({
      tabId: TAB,
      agent: 'droid',
      status: 'ready',
      journalItems: [statusRow(1, handoff('a9'))]
    })

    await vi.waitFor(() => expect(mocks.switchSession).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('tells the user when the switch cannot start at all', () => {
    mocks.switchSession.mockImplementation(() => {
      throw new Error('Only a Droid chat can switch to another Droid session.')
    })
    const view = mount({})
    view.rerender({
      tabId: TAB,
      agent: 'droid',
      status: 'ready',
      journalItems: [statusRow(1, handoff('a8'))]
    })

    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })
})
