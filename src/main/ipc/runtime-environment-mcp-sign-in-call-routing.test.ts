import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RemoteRuntimeSubscription } from '../../shared/remote-runtime-client'
import { advanceRuntimeEnvironmentTransportGeneration } from './runtime-environment-transport-generation'
import { registerRuntimeEnvironmentPassiveHandlers } from './runtime-environment-connectivity-handlers'
import {
  registerRuntimeEnvironmentSubscriptionHandlers,
  type PendingRuntimeSubscription,
  type RetainedRemoteRuntimeSubscription
} from './runtime-environment-subscription-handlers'

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
vi.mock('./runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: mocks.call,
  subscribeRuntimeEnvironment: mocks.subscribe
}))

const subscriptions = new Map<string, RetainedRemoteRuntimeSubscription>()
const pendingSubscriptions = new Map<string, PendingRuntimeSubscription>()
const response = {
  id: 'command',
  ok: true,
  result: { name: 'mcp' },
  _meta: { runtimeId: 'runtime' }
}
const params = {
  sessionId: 'session',
  command: { name: 'mcp', action: { kind: 'sign-in', serverName: 'server' } }
}
const sender = (id = 1) => ({
  id,
  isDestroyed: () => false,
  send: vi.fn(),
  once: vi.fn(),
  removeListener: vi.fn()
})
function handler(channel: string) {
  return mocks.handle.mock.calls.find(([name]) => name === channel)![1]
}
async function subscribe(
  stream: RemoteRuntimeSubscription,
  {
    owner = 1,
    selector = 'environment',
    sessionId = 'session',
    method = 'agentSession.subscribe'
  } = {}
) {
  mocks.subscribe.mockResolvedValueOnce(stream)
  return handler('runtimeEnvironments:subscribe')(
    { sender: sender(owner) },
    { selector, method, params: { sessionId } }
  )
}
function call(overrides: Record<string, unknown> = {}, owner = 1) {
  return handler('runtimeEnvironments:call')(
    { sender: sender(owner) },
    {
      selector: 'environment',
      method: 'agentSession.droidCommand',
      params,
      timeoutMs: 123,
      ...overrides
    }
  )
}
function stream() {
  return {
    requestId: 'transcript',
    sendRequest: vi.fn().mockResolvedValue(response),
    sendBinary: vi.fn(() => true),
    close: vi.fn()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.subscribe.mockReset()
  mocks.call.mockReset().mockResolvedValue(response)
  registerRuntimeEnvironmentSubscriptionHandlers({
    getUserDataPath: () => '/profile',
    remoteRuntimeSubscriptions: subscriptions,
    pendingSubscriptions,
    recordLayoutFrame: vi.fn()
  })
  registerRuntimeEnvironmentPassiveHandlers(() => '/profile', subscriptions)
})
afterEach(() => {
  for (const subscription of subscriptions.values()) {
    subscription.close()
  }
  subscriptions.clear()
  pendingSubscriptions.clear()
})

it('sends MCP sign-in as a unary request on the initiating renderer transcript socket', async () => {
  const transcript = stream()
  await subscribe(transcript)

  await expect(call()).resolves.toEqual(response)

  expect(transcript.sendRequest).toHaveBeenCalledExactlyOnceWith(
    'agentSession.droidCommand',
    params,
    123
  )
  expect(mocks.call).not.toHaveBeenCalled()
  expect(mocks.subscribe).toHaveBeenCalledOnce()
})

it('does not send on a transcript from an invalidated transport generation', async () => {
  const transcript = stream()
  await subscribe(transcript)
  advanceRuntimeEnvironmentTransportGeneration('environment')

  await expect(call()).rejects.toThrow('Runtime environment pairing changed')

  expect(transcript.sendRequest).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalled()
})

it.each([
  { owner: 2 },
  { selector: 'other-environment' },
  { sessionId: 'other-session' },
  { method: 'terminal.multiplex' }
])('does not borrow a subscription with mismatched ownership or identity: %j', async (options) => {
  const unrelated = stream()
  await subscribe(unrelated, options)
  await expect(call()).resolves.toEqual(response)
  expect(unrelated.sendRequest).not.toHaveBeenCalled()
  expect(mocks.call).toHaveBeenCalledOnce()

  const transcript = stream()
  await subscribe(transcript)
  await expect(call()).resolves.toEqual(response)
  expect(transcript.sendRequest).toHaveBeenCalledExactlyOnceWith(
    'agentSession.droidCommand',
    params,
    123
  )
  expect(unrelated.sendRequest).not.toHaveBeenCalled()
  expect(mocks.call).toHaveBeenCalledOnce()
})

it('falls back normally when an older transcript transport has no unary sendRequest', async () => {
  await subscribe({ requestId: 'old', sendBinary: vi.fn(() => true), close: vi.fn() })

  await expect(call()).resolves.toEqual(response)

  expect(mocks.call).toHaveBeenCalledExactlyOnceWith(
    '/profile',
    'environment',
    'agentSession.droidCommand',
    params,
    123,
    undefined,
    undefined,
    { expectedEnvironmentRuntimeId: undefined }
  )
})

it('falls back normally without a retained transcript', async () => {
  await expect(call()).resolves.toEqual(response)
  expect(mocks.call).toHaveBeenCalledOnce()
  expect(mocks.subscribe).not.toHaveBeenCalled()
})

it.each([
  { name: 'mcp', action: { kind: 'list' } },
  { name: 'mcp', action: { kind: 'toggle', serverName: 'server', enabled: false } },
  { name: 'mcp', action: { kind: 'remove', serverName: 'server' } },
  {
    name: 'mcp',
    action: {
      kind: 'add',
      serverName: 'server',
      server: { type: 'http', url: 'https://example.com' }
    }
  },
  { name: 'context' },
  { name: 'compress' }
])('keeps other Droid commands on their normal unary transport: %j', async (command) => {
  const transcript = stream()
  await subscribe(transcript)

  await expect(call({ params: { sessionId: 'session', command } })).resolves.toEqual(response)

  expect(transcript.sendRequest).not.toHaveBeenCalled()
  expect(mocks.call).toHaveBeenCalledOnce()
})

it('does not route another RPC with sign-in-shaped params through the transcript', async () => {
  const transcript = stream()
  await subscribe(transcript)

  await expect(call({ method: 'agentSession.send' })).resolves.toEqual(response)

  expect(transcript.sendRequest).not.toHaveBeenCalled()
  expect(mocks.call).toHaveBeenCalledOnce()
})

it.each([
  { expectedEnvironmentPairingRevision: 2 },
  { expectedEnvironmentRuntimeId: 'other-runtime' }
])('rejects stale renderer identity before sending: %j', async (identity) => {
  const transcript = stream()
  await subscribe(transcript)

  await expect(call(identity)).resolves.toMatchObject({
    ok: false,
    error: { code: 'runtime_environment_changed' }
  })

  expect(transcript.sendRequest).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalled()
})

it('uses the existing unary timeout default on the transcript', async () => {
  const transcript = stream()
  await subscribe(transcript)

  await call({ timeoutMs: undefined })

  expect(transcript.sendRequest).toHaveBeenCalledExactlyOnceWith(
    'agentSession.droidCommand',
    params,
    15_000
  )
})

it('stops selecting the transcript after its owning renderer unsubscribes', async () => {
  const transcript = stream()
  const { subscriptionId } = await subscribe(transcript)
  handler('runtimeEnvironments:unsubscribe')({ sender: sender() }, { subscriptionId })

  await expect(call()).resolves.toEqual(response)

  expect(transcript.close).toHaveBeenCalledOnce()
  expect(transcript.sendRequest).not.toHaveBeenCalled()
  expect(mocks.call).toHaveBeenCalledOnce()
})

it('does not retry a failed transcript command over a different socket', async () => {
  const transcript = stream()
  transcript.sendRequest.mockRejectedValueOnce(new Error('connection closed'))
  await subscribe(transcript)

  await expect(call()).rejects.toThrow('connection closed')

  expect(mocks.call).not.toHaveBeenCalled()
})
