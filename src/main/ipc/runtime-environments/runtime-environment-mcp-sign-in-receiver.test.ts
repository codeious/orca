import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RemoteRuntimeTransportSubscription as RemoteRuntimeSubscription,
  RemoteRuntimeTransportSubscriptionCallbacks as RemoteRuntimeSubscriptionCallbacks
} from '../../../shared/remote-runtime/requests/remote-runtime-subscription-contract'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type * as RuntimeEnvironments from '../../../shared/remote-runtime/host-catalog/runtime-environments'

const fake = vi.hoisted(() => {
  const state: { mainWindow: { isDestroyed: () => boolean } | null } = { mainWindow: null }
  return {
    state,
    openExternal: vi.fn<(url: string) => Promise<void>>(),
    subscribe: vi.fn(),
    sendRequest: vi.fn(),
    close: vi.fn(),
    recordUsage: vi.fn()
  }
})

vi.mock('electron', () => ({ shell: { openExternal: fake.openExternal } }))
vi.mock('../../startup/main-process-state', () => ({ mainProcessState: fake.state }))
vi.mock('./runtime-environment-managed-tunnel', () => ({
  resolveManagedRuntimeEnvironment: async () => ({ id: 'remote' })
}))
vi.mock(
  '../../../shared/remote-runtime/host-catalog/runtime-environments',
  async (importOriginal) => ({
    ...(await importOriginal<typeof RuntimeEnvironments>()),
    getPreferredPairedRuntimeConnection: () => ({ endpoint: 'ws://localhost:1' })
  })
)
vi.mock('./runtime-environment-support-routing', () => ({
  shouldRouteSubscriptionBySupport: () => false
}))
vi.mock('../../../shared/remote-runtime/requests/remote-runtime-subscription-transport', () => ({
  subscribeRemoteRuntimeTransport: fake.subscribe
}))
vi.mock('../../../shared/remote-runtime/host-store/runtime-environment-usage-record', () => ({
  recordRuntimeEnvironmentUsage: fake.recordUsage
}))

import { subscribeRuntimeEnvironment } from './runtime-environment-transport-routing'
import { setRuntimeEnvironmentMcpSignInOpener } from './runtime-environment-mcp-sign-in-receiver'
import { openMcpSignInOnThisMachine } from '../../startup/mcp-sign-in-opener'

const LINK = 'https://auth.example.invalid/authorize?state=fake-in-memory'
let transportCallbacks: RemoteRuntimeSubscriptionCallbacks | undefined
const events: unknown[] = []

function emit(response: RuntimeRpcResponse<unknown>): void {
  if (!transportCallbacks) {
    throw new Error('Subscription has not started')
  }
  transportCallbacks.onResponse(response)
}

function batch(requestId = 'open-1', url = LINK): RuntimeRpcResponse<unknown> {
  return {
    id: 'stream',
    ok: true,
    result: {
      type: 'batch',
      sessionId: 'session',
      batch: { rows: [] },
      mcpSignInOpen: { requestId, url }
    },
    _meta: { runtimeId: 'guest' }
  }
}

function subscribe(
  method = 'agentSession.subscribe',
  isCurrent = () => true,
  signal?: AbortSignal
): Promise<RemoteRuntimeSubscription> {
  return subscribeRuntimeEnvironment(
    '/profile',
    'remote',
    method,
    { sessionId: 'session' },
    1000,
    { onEvent: (event) => events.push(event), onClose: () => {} },
    isCurrent,
    signal
  )
}

async function settled(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function stream(): RemoteRuntimeSubscription {
  return {
    requestId: 'stream',
    close: fake.close,
    sendBinary: () => true,
    sendRequest: fake.sendRequest
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setRuntimeEnvironmentMcpSignInOpener(openMcpSignInOnThisMachine)
  fake.openExternal.mockReset().mockResolvedValue(undefined)
  fake.sendRequest.mockReset().mockResolvedValue({ id: 'ack', ok: true, result: {} })
  fake.state.mainWindow = { isDestroyed: () => false }
  transportCallbacks = undefined
  events.length = 0
  fake.subscribe
    .mockReset()
    .mockImplementation(
      async (
        _pairing: unknown,
        _method: string,
        _params: unknown,
        _timeout: number,
        callbacks: RemoteRuntimeSubscriptionCallbacks
      ): Promise<RemoteRuntimeSubscription> => {
        transportCallbacks = callbacks
        return stream()
      }
    )
})

describe('desktop MCP sign-in stream receiver', () => {
  it('strips the transient link before delivery and opens it once, acknowledging on the stream', async () => {
    await subscribe()
    emit(batch())
    emit(batch())
    await settled()

    expect(events).toEqual([
      {
        type: 'response',
        response: {
          id: 'stream',
          ok: true,
          result: { type: 'batch', sessionId: 'session', batch: { rows: [] } },
          _meta: { runtimeId: 'guest' }
        }
      },
      {
        type: 'response',
        response: {
          id: 'stream',
          ok: true,
          result: { type: 'batch', sessionId: 'session', batch: { rows: [] } },
          _meta: { runtimeId: 'guest' }
        }
      }
    ])
    expect(fake.openExternal).toHaveBeenCalledExactlyOnceWith(
      'https://auth.example.invalid/authorize?state=fake-in-memory'
    )
    expect(fake.sendRequest.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['agentSession.mcpSignInOpened', { sessionId: 'session', requestId: 'open-1', opened: true }]
    ])
  })

  it('opens and acknowledges nothing after close, including an in-flight opening', async () => {
    let complete: (() => void) | undefined
    fake.openExternal.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        })
    )
    const subscription = await subscribe()
    emit(batch())
    subscription.close()
    complete?.()
    emit(batch('late'))
    await settled()

    expect(fake.openExternal).toHaveBeenCalledExactlyOnceWith(
      'https://auth.example.invalid/authorize?state=fake-in-memory'
    )
    expect(fake.sendRequest).not.toHaveBeenCalled()
    expect(JSON.stringify(events)).not.toContain('mcpSignInOpen')
    expect(fake.close).toHaveBeenCalledOnce()
  })
})
