import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registerRuntimeEnvironmentPassiveHandlers } from './runtime-environments/runtime-environment-connectivity-handlers'
import {
  registerRuntimeEnvironmentSubscriptionHandlers,
  type PendingRuntimeSubscription,
  type RetainedRemoteRuntimeSubscription
} from './runtime-environments/runtime-environment-subscription-handlers'
import { advanceRuntimeEnvironmentTransportGeneration } from './runtime-environments/runtime-environment-transport-generation'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  call: vi.fn(),
  subscribe: vi.fn()
}))
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle, on: mocks.on } }))
vi.mock('../../shared/runtime-environment-store', () => ({
  resolveEnvironment: (_profile: string, selector: string) => ({
    id: selector,
    createdAt: 1,
    pairingRevision: 1,
    runtimeId: 'runtime'
  })
}))
vi.mock('./runtime-environments/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: mocks.call,
  subscribeRuntimeEnvironment: mocks.subscribe
}))
const subscriptions = new Map<string, RetainedRemoteRuntimeSubscription>()
const pendingSubscriptions = new Map<string, PendingRuntimeSubscription>()
const response = {
  id: 'command',
  ok: true,
  result: { text: 'done' },
  _meta: { runtimeId: 'runtime' }
}
const params = { envelope: { sessionId: 'chat' }, name: 'mcp', argument: 'sign-in sample' }
const sender = (id = 1) => ({
  id,
  isDestroyed: () => false,
  send: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  removeListener: vi.fn()
})
function handler(channel: string) {
  const entry = mocks.handle.mock.calls.find(([name]) => name === channel)
  if (!entry) {
    throw new Error('Handler not registered')
  }
  return entry[1]
}
async function subscribe(owner = 1, sessionId = 'chat') {
  const stream = {
    requestId: 'stream',
    sendRequest: vi.fn().mockResolvedValue(response),
    sendBinary: () => true,
    close: vi.fn()
  }
  mocks.subscribe.mockResolvedValueOnce(stream)
  await handler('runtimeEnvironments:subscribe')(
    { sender: sender(owner) },
    { selector: 'environment', method: 'agentSession.subscribe', params: { sessionId } }
  )
  return stream
}
function call() {
  return handler('runtimeEnvironments:call')(
    { sender: sender() },
    { selector: 'environment', method: 'agentSession.hostCommand', params }
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  registerRuntimeEnvironmentSubscriptionHandlers({
    getUserDataPath: () => '/profile',
    remoteRuntimeSubscriptions: subscriptions,
    pendingSubscriptions,
    recordLayoutFrame: vi.fn()
  })
  registerRuntimeEnvironmentPassiveHandlers(() => '/profile', undefined, subscriptions)
})
afterEach(() => {
  for (const stream of subscriptions.values()) {
    stream.close()
  }
  subscriptions.clear()
  pendingSubscriptions.clear()
})
it('sends sign-in on the initiating renderer transcript socket rather than a pooled unary socket', async () => {
  const stream = await subscribe()
  await expect(call()).resolves.toEqual(response)
  expect(stream.sendRequest).toHaveBeenCalledExactlyOnceWith(
    'agentSession.hostCommand',
    params,
    195_000
  )
  expect(mocks.call).not.toHaveBeenCalled()
})
it.each([
  [2, 'chat'],
  [1, 'other']
])('refuses another renderer or chat subscription', async (owner, sessionId) => {
  const stream = await subscribe(owner, sessionId)
  await expect(call()).resolves.toMatchObject({
    ok: false,
    error: { code: 'mcp_sign_in_client_unavailable' }
  })
  expect(stream.sendRequest).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalled()
})
it('does not forward through an invalidated transport incarnation', async () => {
  const stream = await subscribe()
  advanceRuntimeEnvironmentTransportGeneration('environment')
  await expect(call()).rejects.toThrow('no longer current')
  expect(stream.sendRequest).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalled()
})
