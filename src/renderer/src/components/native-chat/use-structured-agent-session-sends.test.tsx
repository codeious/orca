// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))

import {
  AGENT_SESSION_AFTER_REPLY_RUNTIME_CAPABILITY,
  type RuntimeCapability
} from '../../../../shared/protocol-version'
import { structuredAgentSessionMessageSendMutation } from '../../../../shared/structured-agent-session-send-mutation'
import { setLocalRuntimeCapabilitiesForTests } from '@/runtime/local-runtime-capabilities'
import { resetStructuredAgentSessionSendsForTests } from './structured-agent-session-message-sender'
import { useStructuredAgentSessionSends } from './use-structured-agent-session-sends'

const QUEUEING = { capability: 'supported', enabled: true } as const

afterEach(() => {
  resetStructuredAgentSessionSendsForTests()
  setLocalRuntimeCapabilitiesForTests(null)
})

describe('a send that waits for the running reply', () => {
  function sendWith(capabilities: readonly RuntimeCapability[], options?: { afterReply?: true }) {
    mocks.call.mockReset()
    mocks.call.mockImplementation(() => new Promise(() => {}))
    setLocalRuntimeCapabilitiesForTests([...capabilities])
    const { result } = renderHook(() =>
      useStructuredAgentSessionSends({
        sessionId: 'session-1',
        target: { kind: 'local' },
        fence: 1,
        submissions: [],
        queuedMessageIds: [],
        queue: { capability: 'unsupported', enabled: false },
        historyLoaded: false,
        isWorking: true
      })
    )
    act(() => {
      result.current.send('then answer this', [], options)
    })
    return vi.waitFor(() => {
      const call = mocks.call.mock.calls.find(([, method]) => method === 'agentSession.send')
      expect(call).toBeDefined()
      return call?.[2]
    })
  }

  it('asks the host to wait when the host advertises it, in the operation fingerprint', async () => {
    const params = await sendWith([AGENT_SESSION_AFTER_REPLY_RUNTIME_CAPABILITY], {
      afterReply: true
    })
    expect(params).toMatchObject({ afterReply: true })
    const expected = structuredAgentSessionMessageSendMutation({
      sessionId: 'session-1',
      clientOperationId: params.envelope.clientOperationId,
      expectedRuntimeFence: 1,
      body: params.body,
      afterReply: true
    })
    expect(params.envelope).toEqual(expected.envelope)
  })

  it('sends an ordinary message to a host that does not advertise it', async () => {
    const params = await sendWith([], { afterReply: true })
    expect(params).not.toHaveProperty('afterReply')
  })

  it('sends an ordinary message when it did not ask to wait', async () => {
    const params = await sendWith([AGENT_SESSION_AFTER_REPLY_RUNTIME_CAPABILITY])
    expect(params).not.toHaveProperty('afterReply')
  })
})

// The composer moves the reader only for a message the transcript draws as a bubble.
it.each([
  ['a text follow-up while the agent works', QUEUEING, true, [], 'queued'],
  ['the same follow-up when the agent is idle', QUEUEING, false, [], true],
  ['with the queue setting off', { capability: 'supported', enabled: false }, true, [], true],
  ['an image, which never queues', QUEUEING, true, [{ path: '/a.png', previewUri: '/a.png' }], true]
] as const)(
  'answers whether %s waits as a queued card',
  (_case, queue, isWorking, images, admission) => {
    mocks.call.mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() =>
      useStructuredAgentSessionSends({
        sessionId: 'session-1',
        target: { kind: 'local' },
        fence: 1,
        submissions: [],
        queuedMessageIds: [],
        queue,
        historyLoaded: false,
        isWorking
      })
    )
    let sent: boolean | 'queued' = false
    act(() => {
      sent = result.current.send('follow up', images)
    })
    expect(sent).toBe(admission)
  }
)

it('takes no second send while the first is out', () => {
  mocks.call.mockImplementation(() => new Promise(() => {}))
  const { result } = renderHook(() =>
    useStructuredAgentSessionSends({
      sessionId: 'session-1',
      target: { kind: 'local' },
      fence: 1,
      submissions: [],
      queuedMessageIds: [],
      queue: QUEUEING,
      historyLoaded: false,
      isWorking: true
    })
  )
  let first: boolean | 'queued' = false
  let second: boolean | 'queued' = true
  act(() => {
    first = result.current.send('one')
    second = result.current.send('two')
  })
  expect(first).toBe('queued')
  expect(second).toBe(false)
})
