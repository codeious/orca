import { expect, vi, type Mock } from 'vitest'
import type { AgentSessionProcessIdentity } from '../../shared/agent-session-record'
import {
  closeProviderTimelineRigs,
  openProviderTimelineRig,
  type ProviderTimelineRig
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import type { DroidAgentConnectionOptions } from './droid-agent-connection'
import type { DroidConnection, DroidSessionDeps } from './droid-session'
import { DroidSessionAdapter } from './droid-session-adapter'
import type { DroidResolvedLaunch } from './droid-structured-launch-resolution'

export const DROID_RIG_SESSION = 'session-timeline'
const cleanups: (() => Promise<void>)[] = []

export async function runDroidRigCleanups(): Promise<void> {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }
  await closeProviderTimelineRigs()
}

export type Reply = (params: unknown) => unknown

export class FakeConnection implements DroidConnection {
  pid = 4123
  closed = false
  rootVerdict: 'live' | 'unverifiable' | 'exited' = 'live'
  processless = false
  protocolVersion: string | undefined = '1.275.0'
  lastCloseResult: DroidConnection['lastCloseResult'] = null
  closeResult: Awaited<ReturnType<DroidConnection['close']>> = { root: 'exited', tree: 'exited' }
  readonly requests: { method: string; params: unknown; timeoutMs?: number | null }[] = []
  readonly replies = new Map<string, Reply>()
  lastId = ''
  private closing = false
  private ids = 0
  private readonly exitListeners: (() => void)[] = []
  constructor(readonly handlers: DroidAgentConnectionOptions) {}
  async request(
    method: string,
    params: unknown = {},
    options: { timeoutMs?: number | null; onId?: (id: string) => void } = {}
  ): Promise<unknown> {
    this.lastId = `orca-${++this.ids}`
    options.onId?.(this.lastId)
    this.requests.push({
      method,
      params,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
    })
    const reply = this.replies.get(method)
    if (reply) {
      return reply(params)
    }
    if (method === 'droid.initialize_session') {
      return { sessionId: 'droid-session-1' }
    }
    if (method === 'droid.load_session') {
      // A real Droid answers a load with the session's content and folder, never its id.
      return { session: { messages: [], title: 'loaded' }, hostId: 'host-1', cwd: '/host/folder' }
    }
    return {}
  }
  async close(): Promise<Awaited<ReturnType<DroidConnection['close']>>> {
    this.closing = true
    this.closed = true
    this.rootVerdict = this.closeResult.root
    this.lastCloseResult = this.closeResult
    if (this.closeResult.root === 'exited') {
      this.exit(new Error('Droid closed'))
    }
    return this.closeResult
  }
  pauseReading(): void {}
  resumeReading(): void {}
  onExit(listener: () => void): void {
    if (this.rootVerdict === 'exited') {
      listener()
    } else {
      this.exitListeners.push(listener)
    }
  }
  notify(notification: Record<string, unknown>): void {
    this.handlers.onNotification?.('droid.session_notification', {
      sessionId: 'droid-session-1',
      notification
    })
  }
  echo(text: string, requestId = this.lastId): void {
    this.notify({
      type: 'create_message',
      message: { id: `user-${text}`, role: 'user', content: [{ type: 'text', text }] },
      requestId
    })
  }
  exit(error = new Error('child exited')): void {
    this.closed = true
    this.rootVerdict = 'exited'
    for (const listener of this.exitListeners.splice(0)) {
      listener()
    }
    this.handlers.onExit?.(error, {
      expected: this.closing,
      exit: { code: 1, signal: null, processless: this.processless }
    })
  }
}

export type DroidAdapterRig = {
  adapter: DroidSessionAdapter
  rig: ProviderTimelineRig
  input: StructuredAgentSessionAcquireInput
  lifecycle: Mock
  settled: Mock
  idle: Mock
  onSpawned: Mock<(process: AgentSessionProcessIdentity) => Promise<void>>
  openConnection: Mock<
    (launch: ProviderProcessLaunch, handlers: DroidAgentConnectionOptions) => FakeConnection
  >
  connections: FakeConnection[]
  start: (options?: Readonly<Record<string, string>>) => Promise<{
    acquired: Awaited<ReturnType<DroidSessionAdapter['acquire']>>
    connection: FakeConnection
  }>
}

/** `script` runs on each connection the adapter opens, before the adapter sends anything. */
export async function setupDroidAdapter(
  launch: Partial<DroidResolvedLaunch> = {},
  script?: (connection: FakeConnection) => void,
  extraDeps: Pick<DroidSessionDeps, 'realpath'> = {}
): Promise<DroidAdapterRig> {
  const rig = await openProviderTimelineRig({ agent: 'droid', sessionId: DROID_RIG_SESSION })
  const connections: FakeConnection[] = []
  const lifecycle = vi.fn(),
    settled = vi.fn(),
    idle = vi.fn()
  const onSpawned = vi.fn(async (_process: AgentSessionProcessIdentity) => {
    expect(connections.at(-1)?.requests).toEqual([])
  })
  const input: StructuredAgentSessionAcquireInput = {
    identity: {
      sessionId: DROID_RIG_SESSION,
      workspaceId: 'folder-1',
      hostId: 'local',
      agent: 'droid',
      providerHandle: null
    },
    fence: 7,
    spawnToken: 'spawn-token',
    events: rig.eventSink,
    onSpawned
  }
  const resolved = vi.fn(async (): Promise<DroidResolvedLaunch> => ({
    command: '/host/bin/droid',
    cwd: '/host/folder',
    env: { PATH: '/host/bin' },
    previous: null,
    autonomyLevel: 'high',
    ...launch
  }))
  const openConnection = vi.fn(
    (_launch: ProviderProcessLaunch, handlers: DroidAgentConnectionOptions) => {
      const connection = new FakeConnection(handlers)
      script?.(connection)
      connections.push(connection)
      return connection
    }
  )
  const adapter = new DroidSessionAdapter({
    resolveLaunch: resolved,
    readProcessStartTime: async () => 12345,
    openConnection,
    onLifecycle: lifecycle,
    onSettled: settled,
    onIdle: idle,
    logger: { warn: vi.fn(), error: vi.fn() },
    ...extraDeps
  })
  cleanups.push(async () => {
    await adapter.closeAll().catch(() => {})
    await adapter.drainObservedExits()
    adapter.acknowledgeSessionRelease(DROID_RIG_SESSION)
  })
  const start = async (options?: Readonly<Record<string, string>>) => {
    const acquired = await adapter.acquire(options ? { ...input, options } : input)
    const connection = connections[0]
    if (!connection) {
      throw new Error('connection missing')
    }
    return { acquired, connection }
  }
  return {
    adapter,
    rig,
    input,
    lifecycle,
    settled,
    idle,
    onSpawned,
    openConnection,
    connections,
    start
  }
}
