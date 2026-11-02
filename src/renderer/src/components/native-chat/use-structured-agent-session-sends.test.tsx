// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))

import type { RuntimeCapability } from '../../../../shared/protocol-version'
import { AGENT_SESSION_AFTER_REPLY_RUNTIME_CAPABILITY } from '../../../../shared/agent-session/structured-agent-session-surface-capabilities'
import { structuredAgentSessionMessageSendMutation } from '../../../../shared/agent-session/requests/structured-agent-session-send-mutation'
import { setLocalRuntimeCapabilitiesForTests } from '@/runtime/local-runtime-capabilities'
import { resetStructuredAgentSessionSendsForTests } from './structured-agent-session-message-sender'
import { useStructuredAgentSessionSends } from './use-structured-agent-session-sends'

const QUEUEING = {
  capability: 'supported',
  followUpsQueue: true,
  isWorking: true,
  stopping: false,
  session: { queuedMessages: [] },
  prompts: []
} as const

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
        queue: { ...QUEUEING, capability: 'unsupported' },
        historyLoaded: false,
        isWorking: true
      })
    )
    act(() => {
      const sent = result.current.send('then answer this', [], options)
      expect(sent).toBe(
        options?.afterReply && capabilities.includes(AGENT_SESSION_AFTER_REPLY_RUNTIME_CAPABILITY)
          ? 'queued'
          : true
      )
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
