// The installed runtime and host own forwarding; only binary discovery and the Droid child are scripted.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../shared/agent-session-wire'
import { FakeConnection } from '../droid/droid-adapter-rig.test-support'
import { DROID_ACCOUNT_HOME_VARIABLE } from '../droid/droid-agent-definition'
import { DroidHostTextError } from '../droid/droid-host-text'
import * as droidLaunch from '../droid/droid-launch-resolution'
import type { DroidMcpSignInOpener } from '../droid/droid-mcp-sign-in'
import type { McpSignInCaller } from '../native-chat/agent-session-wire/agent-session-mcp-sign-in-forwarding'
import { hostTestAttachParams } from '../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import {
  ensureStructuredAgentSessionHost,
  stopStructuredAgentSessionRuntime
} from './structured-agent-session-runtime'

const SESSION = 'mcp-forwarding-chat'
const HOST = 'runtime:5c2e9a7e-1111-4222-8333-944455556666'
const CALLER: McpSignInCaller = { callerKey: 'desktop-a', connectionId: 'initiator' }
const SIGN_IN = { name: 'mcp', action: { kind: 'sign-in', serverName: 'remote' } } as const
const OPENED_KEY = 'components.native-chat.droidHost.mcpLinkOpened'
let root: string | undefined
let finishAuth = () => {}

function signedIn(answer: unknown): boolean {
  if (!answer || typeof answer !== 'object' || !('name' in answer) || answer.name !== 'mcp') {
    return false
  }
  return (
    'changed' in answer &&
    answer.changed !== null &&
    typeof answer.changed === 'object' &&
    'kind' in answer.changed &&
    answer.changed.kind === 'signed-in'
  )
}

function linkNotOpened(error: unknown): boolean {
  return (
    error instanceof DroidHostTextError &&
    error.textKey === 'components.native-chat.droidHost.mcpLinkNotOpened'
  )
}

afterEach(async () => {
  finishAuth()
  vi.useRealTimers()
  await stopStructuredAgentSessionRuntime()
  vi.restoreAllMocks()
  if (root) {
    await rm(root, { recursive: true, force: true })
    root = undefined
  }
})

async function rig(openMcpSignIn?: DroidMcpSignInOpener) {
  root = await mkdtemp(join(tmpdir(), 'orca-runtime-mcp-forward-'))
  const directory = root
  vi.spyOn(droidLaunch, 'resolveDroidCommand').mockReturnValue(join(directory, 'droid'))
  vi.spyOn(droidLaunch, 'readDroidVersion').mockResolvedValue('0.249.0')
  const logger = { warn: vi.fn(), error: vi.fn() }
  const connections: FakeConnection[] = []
  const link = new URL(
    '/authorize?code=never-written&state=only-in-memory',
    'https://fake.invalid'
  ).toString()
  const host = await ensureStructuredAgentSessionHost({
    stateDirectory: directory,
    hostId: HOST,
    claimKeyId: 'key-1',
    resolveWorkspacePath: async () => directory,
    resolveLaunchArgs: () => [],
    resolveClaudeAuthPolicy: () => ({ account: 'managed' }),
    resolveEnvironment: async () => ({ HOME: directory, USERPROFILE: directory, PATH: '' }),
    readProcessStartTime: async () => 12345,
    logger,
    ...(openMcpSignIn ? { openMcpSignIn } : {}),
    openDroidConnection: (_launch, handlers) => {
      const connection = new FakeConnection(handlers)
      connection.replies.set('droid.list_mcp_servers', () => ({
        servers: [
          { name: 'remote', status: 'disconnected', serverType: 'http', requiresAuth: true }
        ]
      }))
      connection.replies.set('droid.authenticate_mcp_server', () => {
        const answer = new Promise((resolve) => {
          finishAuth = () => resolve({ success: true })
        })
        connection.notify({
          type: 'mcp_auth_required',
          serverName: 'remote',
          authUrl: link,
          state: 'one',
          message: `Open ${link} to sign in`
        })
        return answer
      })
      connections.push(connection)
      return connection
    }
  })
  const attached = await host.attach(
    { callerKey: CALLER.callerKey },
    hostTestAttachParams(null, {
      envelope: {
        sessionId: SESSION,
        clientOperationId: `${Date.now()}-${'1'.padStart(32, '0')}`,
        expectedRuntimeFence: null,
        payloadFingerprint: ''
      },
      location: {
        executionHostId: 'local',
        wslDistro: null,
        workspaceId: 'folder-1',
        workspaceKind: 'folder'
      },
      provider: 'droid',
      agent: 'droid',
      accountHome: { variable: DROID_ACCOUNT_HOME_VARIABLE, path: directory },
      providerHandle: undefined
    })
  )
  expect(attached.ok).toBe(true)
  const connection = connections[0]
  if (!connection) {
    throw new Error('Scripted Droid child was not started')
  }
  let requestId = ''
  let deliveries = 0
  let otherDeliveries = 0
  let rightLink = false
  const published: AgentSessionSubscribeEvent[] = []
  const subscribe = (id: string, caller?: McpSignInCaller) =>
    host.subscribe({
      id,
      sessionId: SESSION,
      ...(caller ? { mcpSignInCaller: caller } : {}),
      emit: (event) => {
        if (event.type === 'batch' && event.mcpSignInOpen) {
          if (id === CALLER.connectionId) {
            deliveries += 1
            requestId = event.mcpSignInOpen.requestId
            rightLink = event.mcpSignInOpen.url === link
          } else {
            otherDeliveries += 1
          }
          return
        }
        published.push(event)
      }
    })
  // Earlier readers must not steal the command, even if they share its caller key.
  await subscribe('old-connection', { ...CALLER, connectionId: 'old-connection' })
  await subscribe('other-desktop', { callerKey: 'desktop-b', connectionId: 'other-desktop' })
  await subscribe('mobile')
  await subscribe(CALLER.connectionId, CALLER)
  const acknowledge = (opened: boolean) =>
    host.mcpSignIn.acknowledge(SESSION, requestId, CALLER.connectionId, CALLER.callerKey, opened)
  const snapshot = async () => {
    await host.flushStreamedEvents(SESSION)
    return host.journalSnapshot(SESSION)
  }
  const hasOpenedStatus = async () => JSON.stringify(await snapshot()).includes(OPENED_KEY)
  const privateEvidence = async (answer: unknown) => {
    const evidence = JSON.stringify([
      await snapshot(),
      published,
      logger.warn.mock.calls,
      logger.error.mock.calls,
      answer,
      ...(answer instanceof Error ? [answer.message, answer.stack] : [])
    ])
    return !['fake.invalid', 'never-written', 'only-in-memory', 'authUrl'].some((part) =>
      evidence.includes(part)
    )
  }
  return {
    host,
    connections,
    run: () => host.droidCommand(SESSION, SIGN_IN, CALLER),
    acknowledge,
    deliveries: () => deliveries,
    otherDeliveries: () => otherDeliveries,
    rightLink: () => rightLink,
    hasOpenedStatus,
    privateEvidence,
    snapshot
  }
}

describe('MCP sign-in through the installed Droid runtime registration and real host', () => {
  it('uses the command caller and publishes localized opened status only after a true acknowledgment', async () => {
    const r = await rig()
    const pending = r.run()
    await vi.waitFor(() => expect(r.deliveries()).toBe(1))
    expect(r.rightLink()).toBe(true)
    expect(r.otherDeliveries()).toBe(0)
    expect(await r.hasOpenedStatus()).toBe(false)
    expect(r.acknowledge(true)).toBe(true)
    await vi.waitFor(async () => expect(await r.hasOpenedStatus()).toBe(true))
    finishAuth()
    const answer = await pending
    expect(signedIn(answer)).toBe(true)
    const snapshot = await r.snapshot()
    expect(
      snapshot.items.some(
        ({ body }) =>
          body.kind === 'status' &&
          body.textKey === OPENED_KEY &&
          body.textParams?.serverName === 'remote' &&
          body.text.length > 0
      )
    ).toBe(true)
    expect(r.acknowledge(true)).toBe(false)
    expect(r.connections.length).toBe(1)
    expect(r.host.deps.store.getRecord(SESSION)?.location.workspaceKind === 'folder').toBe(true)
    expect(await r.privateEvidence(answer)).toBe(true)
  })

  it('does not publish opened status when the initiating desktop refuses the request', async () => {
    const r = await rig()
    const pending = r.run().catch((error: unknown) => error)
    await vi.waitFor(() => expect(r.deliveries()).toBe(1))
    expect(r.acknowledge(false)).toBe(true)
    const failure = await pending
    expect(linkNotOpened(failure)).toBe(true)
    expect(await r.hasOpenedStatus()).toBe(false)
    expect(r.otherDeliveries()).toBe(0)
    expect(await r.privateEvidence(failure)).toBe(true)
  })

  it('hiding the real host tab cancels a pending open without waiting for its deadline', async () => {
    const r = await rig()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let settled = false
    const pending = r
      .run()
      .catch((error: unknown) => error)
      .then((answer) => {
        settled = true
        return answer
      })
    await vi.waitFor(() => expect(r.deliveries()).toBe(1))
    expect(settled).toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    await r.host.setSessionTabVisibility(SESSION, false)
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 100 })
    const failure = await pending
    expect(linkNotOpened(failure)).toBe(true)
    expect(r.acknowledge(true)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
    expect(await r.hasOpenedStatus()).toBe(false)
    expect(await r.privateEvidence(failure)).toBe(true)
  })

  it.each([true, false])(
    'keeps the local opener authoritative when it returns %s',
    async (opened) => {
      let localOpens = 0
      const r = await rig(() => {
        localOpens += 1
        return opened
      })
      const pending = r.run().catch((error: unknown) => error)
      await vi.waitFor(() => expect(localOpens).toBe(1))
      finishAuth()
      const answer = await pending
      expect(opened ? signedIn(answer) : linkNotOpened(answer)).toBe(true)
      expect(r.deliveries()).toBe(0)
      expect(r.otherDeliveries()).toBe(0)
      expect(await r.hasOpenedStatus()).toBe(false)
      expect(await r.privateEvidence(answer)).toBe(true)
    }
  )

  it('falls back without selecting any subscriber when the command has no caller identity', async () => {
    const r = await rig()
    const failure = await r.host.droidCommand(SESSION, SIGN_IN).catch((error: unknown) => error)
    expect(linkNotOpened(failure)).toBe(true)
    expect(r.deliveries()).toBe(0)
    expect(r.otherDeliveries()).toBe(0)
    expect(await r.hasOpenedStatus()).toBe(false)
    expect(await r.privateEvidence(failure)).toBe(true)
  })
})
