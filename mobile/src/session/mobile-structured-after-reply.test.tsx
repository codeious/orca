import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_STRUCTURED_AGENT_SESSION } from '../../../src/shared/agent-session/structured-agent-session-reducer'
import { AGENT_SESSION_AFTER_REPLY_RUNTIME_CAPABILITY } from '../../../src/shared/agent-session/structured-agent-session-surface-capabilities'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileStructuredSendWithOutcome } from './use-mobile-structured-send-with-outcome'
import { sendMobileStructuredAgentSessionMessage } from './mobile-structured-agent-session-send'
import { structuredAgentSessionHostSupport } from './mobile-structured-agent-session-host-support'

vi.mock('./mobile-structured-agent-session-send', () => ({
  sendMobileStructuredAgentSessionMessage: vi.fn().mockResolvedValue('accepted')
}))
const client: RpcClient = {
  sendRequest: vi.fn(),
  subscribe: vi.fn(),
  updateTerminalSubscriptionViewport: vi.fn(),
  getState: () => 'connected',
  getReconnectAttempt: () => 0,
  getLastConnectedAt: () => null,
  onStateChange: () => vi.fn(),
  notifyForeground: vi.fn(),
  close: vi.fn()
}
let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
  vi.clearAllMocks()
})

describe('mobile after-reply capability', () => {
  it.each([false, true])('adds no new field until support is known: %s', async (supported) => {
    const support = structuredAgentSessionHostSupport(
      supported ? [AGENT_SESSION_AFTER_REPLY_RUNTIME_CAPABILITY] : []
    )
    let send: ReturnType<typeof useMobileStructuredSendWithOutcome> | undefined
    function Probe() {
      send = useMobileStructuredSendWithOutcome({
        agent: 'droid',
        client,
        sessionId: 'session',
        enabled: true,
        queueCapable: false,
        queueFollowUps: false,
        commandsWait: false,
        stateRef: { current: { ...EMPTY_STRUCTURED_AGENT_SESSION, fence: 1 } },
        stopping: false,
        queueSendsNext: false,
        accept: vi.fn(),
        hold: vi.fn(),
        commandPending: { current: false },
        sendsOut: { sending: () => false, trackSend: (fn) => fn },
        controller: { snapshot: [], setOption: async () => false, invokeAction: async () => false },
        onSendError: vi.fn(),
        waitsForReply: support.afterReply
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
    await act(async () => {
      expect(
        await send?.('Next', undefined, undefined, undefined, undefined, { afterReply: true })
      ).toBe('accepted')
    })
    const [params] = vi.mocked(sendMobileStructuredAgentSessionMessage).mock.calls[0]!
    if (supported) {
      expect(params.afterReply).toBe(true)
    } else {
      expect(params).not.toHaveProperty('afterReply')
    }
  })
})
