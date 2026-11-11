import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it } from 'vitest'
import { EMPTY_STRUCTURED_AGENT_SESSION } from '../../../../../src/shared/agent-session/structured-agent-session-reducer'
import type { RpcClient } from '../../../transport/rpc/rpc-client-contract'
import { useMobileStructuredSendWithOutcome } from './use-mobile-structured-send-with-outcome'

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

it('carries the after-reply intent through the real send path to a capable host', async () => {
  const requests: { method: string; params: unknown }[] = []
  const client: RpcClient = {
    sendRequest: async (method, params) => {
      requests.push({ method, params })
      return {
        id: 'reply',
        ok: true,
        result: {
          ok: true,
          value: { clientMessageId: 'message', submission: { dispatchState: 'accepted' } }
        }
      }
    },
    subscribe: () => () => {},
    updateTerminalSubscriptionViewport: () => {},
    getState: () => 'connected',
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null,
    onStateChange: () => () => {},
    notifyForeground: () => {},
    close: () => {}
  }
  let send: ReturnType<typeof useMobileStructuredSendWithOutcome> | undefined
  function Probe() {
    send = useMobileStructuredSendWithOutcome({
      agent: 'codex',
      client,
      sessionId: 'session',
      enabled: true,
      queueCapable: false,
      queueFollowUps: false,
      commandsWait: false,
      stateRef: { current: { ...EMPTY_STRUCTURED_AGENT_SESSION, fence: 1 } },
      stopping: false,
      queueSendsNext: false,
      accept: () => {},
      acknowledge: () => {},
      reject: () => {},
      holdUnconfirmed: () => {},
      commandPending: { current: false },
      onClearSent: () => () => {},
      sendsOut: { sending: () => false, trackSend: (fn) => fn },
      controller: { snapshot: [], setOption: async () => false, invokeAction: async () => false },
      onSendError: () => {},
      waitsForReply: true
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
  expect(requests).toMatchObject([
    {
      method: 'agentSession.send',
      params: {
        afterReply: true,
        body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'Next' }] }
      }
    }
  ])
})
