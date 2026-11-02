import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RemoteRuntimeSubscription,
  RemoteRuntimeSubscriptionCallbacks
} from '../../shared/remote-runtime/remote-runtime-client'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import type * as RuntimeEnvironments from '../../shared/runtime-environments'
import { remoteRuntimeClientCapabilities } from '../../shared/remote-runtime/remote-runtime-client-capabilities'
import { NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../shared/protocol-version'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime/remote-runtime-client-error'

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
vi.mock('../startup/main-process-state', () => ({ mainProcessState: fake.state }))
vi.mock('./runtime-environments/runtime-environment-managed-tunnel', () => ({
  resolveManagedRuntimeEnvironment: async () => ({ id: 'remote' })
}))
vi.mock('../../shared/runtime-environments', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeEnvironments>()),
  getPreferredPairedRuntimeConnection: () => ({ endpoint: 'ws://localhost:1' })
}))
vi.mock('./runtime-environments/runtime-environment-support-routing', () => ({
  shouldRouteSubscriptionBySupport: () => false
}))
vi.mock('../../shared/remote-runtime/remote-runtime-client', () => ({
  subscribeRemoteRuntimeRequest: fake.subscribe
}))
vi.mock('./runtime-environments/runtime-environment-usage-record', () => ({
  recordRuntimeEnvironmentUsage: fake.recordUsage
}))

import { subscribeRuntimeEnvironment } from './runtime-environments/runtime-environment-transport-routing'

const link = (): string =>
  new URL('/authorize?state=fake-in-memory', 'https://auth.example.invalid').href
let transportCallbacks: RemoteRuntimeSubscriptionCallbacks | undefined
const events: unknown[] = []

function emit(response: RuntimeRpcResponse<unknown>): void {
  if (!transportCallbacks) {
    throw new Error('Subscription has not started')
  }
  transportCallbacks.onResponse(response)
}

function batch(requestId = 'open-1', url = link()): RuntimeRpcResponse<unknown> {
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
  it('advertises the browser receiver only on desktop without changing strict subscribe params', async () => {
    await subscribe()
    const capability = 'agent-session.mcp-sign-in-open.v1'
    const options = fake.subscribe.mock.calls[0]?.[5]
    expect(options?.clientCapabilities?.includes(capability) === true).toBe(true)
    expect(remoteRuntimeClientCapabilities().some((value) => value === capability)).toBe(false)
    expect(
      NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES.some((value) => String(value) === capability)
    ).toBe(false)
    expect(
      JSON.stringify(fake.subscribe.mock.calls[0]?.[2]) === JSON.stringify({ sessionId: 'session' })
    ).toBe(true)
  })

  it('strips the transient link before delivery and opens it once, acknowledging on the stream', async () => {
    await subscribe()
    const response = batch()
    emit(response)
    emit(response)
    await settled()

    expect(events.length === 2).toBe(true)
    expect(JSON.stringify(events).includes('mcpSignInOpen')).toBe(false)
    expect(JSON.stringify(events).includes(link())).toBe(false)
    expect(fake.openExternal.mock.calls.length === 1).toBe(true)
    expect(fake.openExternal.mock.calls[0]?.[0] === link()).toBe(true)
    expect(fake.sendRequest.mock.calls.length === 1).toBe(true)
    expect(
      JSON.stringify(fake.sendRequest.mock.calls[0]?.slice(0, 2)) ===
        JSON.stringify([
          'agentSession.mcpSignInOpened',
          { sessionId: 'session', requestId: 'open-1', opened: true }
        ])
    ).toBe(true)
    expect(JSON.stringify(fake.recordUsage.mock.calls).includes(link())).toBe(false)
  })

  it.each([
    'refused scheme',
    'browser rejects',
    'browser throws',
    'window missing',
    'window destroyed'
  ])('acknowledges false for %s without delivering or logging the link', async (failure) => {
    let url = link()
    if (failure === 'refused scheme') {
      url = 'javascript:void(0)'
    }
    if (failure === 'browser rejects') {
      fake.openExternal.mockRejectedValue(new Error(`Cannot open ${url}`))
    }
    if (failure === 'browser throws') {
      fake.openExternal.mockImplementation(() => {
        throw new Error(`Cannot open ${url}`)
      })
    }
    if (failure === 'window missing') {
      fake.state.mainWindow = null
    }
    if (failure === 'window destroyed') {
      fake.state.mainWindow = { isDestroyed: () => true }
    }
    const log = vi.spyOn(console, 'error')
    const warn = vi.spyOn(console, 'warn')
    try {
      await subscribe()
      emit(batch('refused', url))
      await settled()

      expect(fake.openExternal.mock.calls.length === (failure.startsWith('browser') ? 1 : 0)).toBe(
        true
      )
      expect(
        JSON.stringify(fake.sendRequest.mock.calls[0]?.[1]) ===
          JSON.stringify({ sessionId: 'session', requestId: 'refused', opened: false })
      ).toBe(true)
      expect(JSON.stringify(events).includes(url)).toBe(false)
      expect(JSON.stringify(fake.sendRequest.mock.calls).includes(url)).toBe(false)
      expect(JSON.stringify(log.mock.calls).includes(url)).toBe(false)
      expect(JSON.stringify(warn.mock.calls).includes(url)).toBe(false)
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
  })

  it('waits for the subscription handle when the opening finishes during creation', async () => {
    fake.subscribe.mockImplementationOnce(
      async (
        _pairing: unknown,
        _method: string,
        _params: unknown,
        _timeout: number,
        callbacks: RemoteRuntimeSubscriptionCallbacks
      ) => {
        transportCallbacks = callbacks
        emit(batch())
        await settled()
        expect(fake.sendRequest.mock.calls.length === 0).toBe(true)
        return stream()
      }
    )
    await subscribe()
    await settled()
    expect(fake.openExternal.mock.calls.length === 1).toBe(true)
    expect(fake.sendRequest.mock.calls.length === 1).toBe(true)
  })

  it.each(['close', 'disconnect', 'abort', 'replaced', 'error'])(
    'opens and acknowledges nothing after %s, including an in-flight opening',
    async (reason) => {
      let complete: (() => void) | undefined
      let current = true
      const controller = new AbortController()
      fake.openExternal.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve
          })
      )
      const subscription = await subscribe(
        'agentSession.subscribe',
        () => current,
        controller.signal
      )
      emit(batch())
      if (reason === 'close') {
        subscription.close()
      }
      if (reason === 'disconnect') {
        transportCallbacks?.onClose?.()
      }
      if (reason === 'abort') {
        controller.abort()
      }
      if (reason === 'replaced') {
        current = false
      }
      if (reason === 'error') {
        transportCallbacks?.onError(new RemoteRuntimeClientError('disconnected', 'Connection lost'))
      }
      complete?.()
      emit(batch('late'))
      await settled()
      expect(fake.openExternal.mock.calls.length === 1).toBe(true)
      expect(fake.sendRequest.mock.calls.length === 0).toBe(true)
      expect(JSON.stringify(events).includes(link())).toBe(false)
      if (reason === 'close') {
        expect(fake.close.mock.calls.length === 1).toBe(true)
      }
    }
  )

  it('discards a queued acknowledgement if disconnected before creation completes', async () => {
    fake.subscribe.mockImplementationOnce(
      async (
        _pairing: unknown,
        _method: string,
        _params: unknown,
        _timeout: number,
        callbacks: RemoteRuntimeSubscriptionCallbacks
      ) => {
        transportCallbacks = callbacks
        emit(batch())
        await settled()
        callbacks.onClose?.()
        emit(batch('late'))
        return stream()
      }
    )
    await subscribe()
    await settled()
    expect(fake.openExternal.mock.calls.length === 1).toBe(true)
    expect(fake.sendRequest.mock.calls.length === 0).toBe(true)
  })

  it.each(['reject', 'throw'])(
    'discards acknowledgement errors that %s without leaking their text',
    async (failure) => {
      if (failure === 'reject') {
        fake.sendRequest.mockRejectedValue(new Error(`Cannot send ${link()}`))
      }
      if (failure === 'throw') {
        fake.sendRequest.mockImplementation(() => {
          throw new Error(`Cannot send ${link()}`)
        })
      }
      await subscribe()
      emit(batch())
      await settled()
      expect(fake.sendRequest.mock.calls.length === 1).toBe(true)
      expect(JSON.stringify(events).includes(link())).toBe(false)
    }
  )

  it('keeps replay protection bounded and fails closed instead of evicting old request IDs', async () => {
    await subscribe()
    for (let index = 0; index < 1000; index++) {
      emit(batch(`request-${index}`))
    }
    emit(batch('request-0'))
    await settled()
    expect(fake.openExternal.mock.calls.length > 0).toBe(true)
    expect(fake.openExternal.mock.calls.length <= 64).toBe(true)
    expect(fake.sendRequest.mock.calls.length === fake.openExternal.mock.calls.length).toBe(true)
    expect(JSON.stringify(events).includes(link())).toBe(false)
  })

  it('preserves an older guest batch without forwarding a link or sending an acknowledgement', async () => {
    await subscribe()
    const response: RuntimeRpcResponse<unknown> = {
      id: 'stream',
      ok: true,
      result: { type: 'batch', sessionId: 'session', batch: { rows: [] } },
      _meta: { runtimeId: 'older-guest' }
    }
    emit(response)
    await settled()
    expect(JSON.stringify(events) === JSON.stringify([{ type: 'response', response }])).toBe(true)
    expect(fake.openExternal.mock.calls.length === 0).toBe(true)
    expect(fake.sendRequest.mock.calls.length === 0).toBe(true)
  })

  it('leaves unrelated methods and binary delivery unchanged', async () => {
    const subscription = await subscribe('other.subscribe')
    const response = batch()
    emit(response)
    transportCallbacks?.onBinary?.(new Uint8Array([1]))
    expect(JSON.stringify(events[0]) === JSON.stringify({ type: 'response', response })).toBe(true)
    expect(subscription.sendBinary(new Uint8Array([1]))).toBe(true)
    expect(fake.openExternal.mock.calls.length === 0).toBe(true)
    expect(fake.sendRequest.mock.calls.length === 0).toBe(true)
    subscription.close()
    expect(fake.close.mock.calls.length === 1).toBe(true)
  })
})
