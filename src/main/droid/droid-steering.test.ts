import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AgentJournalMessageItem } from '../../shared/agent-session-journal-types'
import { dispatchWasWithdrawn } from '../../shared/structured-agent-session-dispatch-rejection'
import {
  closeProviderTimelineRigs,
  openProviderTimelineRig
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import type { DroidAgentConnectionOptions } from './droid-agent-connection'
import type { DroidConnection } from './droid-session'
import { DroidSessionAdapter } from './droid-session-adapter'
import type { DroidResolvedLaunch } from './droid-structured-launch-resolution'

const sessionId = 'session-timeline'
const fence = 7
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }
  await closeProviderTimelineRigs()
})

const fixtureRow = z.object({
  dir: z.string(),
  frame: z.looseObject({
    type: z.string().optional(),
    id: z.string().optional(),
    method: z.string().optional(),
    params: z
      .looseObject({
        text: z.string().optional(),
        notification: z.record(z.string(), z.unknown()).optional()
      })
      .optional()
  })
})

function interruptFixture() {
  return readFileSync(
    join(import.meta.dirname, '__fixtures__', 'end-of-turn-interrupt.jsonl'),
    'utf8'
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => fixtureRow.parse(JSON.parse(line)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function remap(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => remap(item, ids))
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === 'requestId' && typeof item === 'string' ? (ids.get(item) ?? item) : remap(item, ids)
    ])
  )
}

class FakeConnection implements DroidConnection {
  pid = 4123
  closed = false
  rootVerdict: DroidConnection['rootVerdict'] = 'live'
  processless = false
  protocolVersion: string | undefined = '1.275.0'
  lastCloseResult: DroidConnection['lastCloseResult'] = null
  lastId = ''
  readonly requests: { method: string; params: unknown }[] = []
  private ids = 0
  private readonly exitListeners: (() => void)[] = []
  constructor(private readonly handlers: DroidAgentConnectionOptions) {}
  async request(
    method: string,
    params: unknown = {},
    options?: { timeoutMs?: number | null; onId?: (id: string) => void }
  ): Promise<unknown> {
    this.lastId = `orca-${++this.ids}`
    options?.onId?.(this.lastId)
    this.requests.push({ method, params })
    return method === 'droid.initialize_session' ? { sessionId: 'droid-session-1' } : {}
  }
  async close(): Promise<Awaited<ReturnType<DroidConnection['close']>>> {
    this.closed = true
    this.rootVerdict = 'exited'
    this.lastCloseResult = { root: 'exited', tree: 'exited' }
    this.exit(new Error('Droid closed'))
    return this.lastCloseResult
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
  exit(error = new Error('child exited')): void {
    this.closed = true
    this.rootVerdict = 'exited'
    for (const listener of this.exitListeners.splice(0)) {
      listener()
    }
    this.handlers.onExit?.(error, {
      expected: false,
      exit: { code: 1, signal: null, processless: false }
    })
  }
}

const text = (value: string): AgentJournalMessageItem => ({
  kind: 'message',
  role: 'user',
  blocks: [{ type: 'text', text: value }]
})

async function setup() {
  const rig = await openProviderTimelineRig({ agent: 'droid', sessionId })
  const connections: FakeConnection[] = []
  const settled = vi.fn()
  const warn = vi.fn()
  const input: StructuredAgentSessionAcquireInput = {
    identity: {
      sessionId,
      workspaceId: 'folder-1',
      hostId: 'local',
      agent: 'droid',
      providerHandle: null
    },
    fence,
    spawnToken: 'spawn-token',
    events: rig.eventSink
  }
  const adapter = new DroidSessionAdapter({
    resolveLaunch: async (): Promise<DroidResolvedLaunch> => ({
      command: '/host/bin/droid',
      cwd: '/host/folder',
      env: { PATH: '/host/bin' },
      autonomyLevel: 'off',
      previous: null
    }),
    readProcessStartTime: async () => 12345,
    openConnection: (_launch: ProviderProcessLaunch, handlers: DroidAgentConnectionOptions) => {
      const connection = new FakeConnection(handlers)
      connections.push(connection)
      return connection
    },
    onLifecycle: vi.fn(),
    onSettled: settled,
    onIdle: vi.fn(),
    logger: { warn, error: vi.fn() }
  })
  cleanups.push(async () => {
    await adapter.closeAll().catch(() => {})
    await adapter.drainObservedExits()
    adapter.acknowledgeSessionRelease(sessionId)
  })
  await adapter.acquire(input)
  const connection = connections[0]
  if (!connection) {
    throw new Error('connection missing')
  }
  return { adapter, rig, connection, settled, warn }
}

async function promptThenSteer(h: Awaited<ReturnType<typeof setup>>) {
  await h.adapter.dispatch({
    sessionId,
    clientMessageId: 'prompt-1',
    body: text('hello'),
    fence
  })
  h.connection.notify({ type: 'droid_working_state_changed', newState: 'thinking' })
  h.connection.notify({
    type: 'create_message',
    message: { id: 'msg-hello', role: 'user', content: [{ type: 'text', text: 'hello' }] },
    requestId: h.connection.lastId
  })
  const outcome = await h.adapter.dispatch({
    sessionId,
    clientMessageId: 'steer-1',
    body: text('later'),
    fence
  })
  return outcome
}

describe('a steer sent while Droid is working', () => {
  it('stays pending on the receipt, is confirmed by the echo, and is withdrawn when Droid discards it', async () => {
    const h = await setup()
    const ids = new Map<string, string>()
    let steer: { state: string } | undefined
    let discardedWhileRunning = false

    for (const row of interruptFixture()) {
      const { frame } = row
      if (row.dir === 'out' && frame.method === 'droid.add_user_message') {
        const clientMessageId = frame.id === 'r3' ? 'steer-1' : 'prompt-1'
        const outcome = await h.adapter.dispatch({
          sessionId,
          clientMessageId,
          body: text(frame.params?.text ?? ''),
          fence
        })
        if (frame.id) {
          ids.set(frame.id, h.connection.lastId)
        }
        if (clientMessageId === 'steer-1') {
          steer = outcome
        }
        continue
      }
      if (row.dir === 'out' && frame.method === 'droid.interrupt_session') {
        await h.adapter.cancelTurn({ sessionId, fence })
        continue
      }
      if (row.dir !== 'in' || frame.type !== 'notification' || !frame.params?.notification) {
        continue
      }
      const notification = remap(frame.params.notification, ids)
      if (!isRecord(notification)) {
        throw new Error('Droid notification was not an object')
      }
      h.connection.notify(notification)
      if (
        'type' in notification &&
        notification.type === 'queued_messages_discarded' &&
        (await h.rig.turns()).at(-1)?.state === 'running'
      ) {
        discardedWhileRunning = true
      }
    }

    expect(h.connection.requests.map(({ method }) => method)).toEqual([
      'droid.initialize_session',
      'droid.add_user_message',
      'droid.add_user_message',
      'droid.interrupt_session'
    ])
    expect(h.connection.requests[1]?.params).toEqual({
      text: expect.stringContaining('STEP1')
    })
    expect(h.connection.requests[2]?.params).toMatchObject({
      queuePlacement: 'end_of_turn',
      text: expect.stringContaining('STEERMARK')
    })
    expect(JSON.stringify(h.connection.requests)).not.toContain('end_of_loop')
    expect(steer).toEqual({ state: 'admitted' })
    expect(discardedWhileRunning).toBe(true)
    expect(h.settled.mock.calls.map(([settlement]) => settlement)).toEqual([
      {
        sessionId,
        clientMessageId: 'prompt-1',
        fence,
        outcome: {
          state: 'accepted',
          providerIdentity: { provider: 'droid', messageId: '<id-1>' }
        }
      },
      {
        sessionId,
        clientMessageId: 'steer-1',
        fence,
        outcome: {
          state: 'rejected',
          reason: 'provider_cancelled_before_start',
          rejection: { kind: 'cancelled' }
        }
      }
    ])
    const withdrawn = h.settled.mock.calls[1]?.[0].outcome
    expect(
      dispatchWasWithdrawn({
        dispatchState: 'rejected',
        reason: withdrawn.reason,
        rejection: withdrawn.rejection
      })
    ).toBe(true)
    const tools = (await h.rig.rows()).flatMap(({ body }) =>
      body.kind === 'tool-call' ? [`${body.callId}:${body.state}`] : []
    )
    expect(tools).toEqual(['<call-1>:completed', '<call-2>:failed'])
    expect(JSON.stringify(await h.rig.rows())).not.toContain('STEERMARK')
  })

  it('leaves the steer unknown when the turn ends with neither an echo nor a discard', async () => {
    const h = await setup()
    expect(await promptThenSteer(h)).toEqual({ state: 'admitted' })

    h.connection.notify({ type: 'agent_turn_completed', reason: 'completed', turnId: 't' })

    const steer = h.settled.mock.calls
      .map(([settlement]) => settlement)
      .filter((settlement) => settlement.clientMessageId === 'steer-1')
    expect(steer).toEqual([
      {
        sessionId,
        clientMessageId: 'steer-1',
        fence,
        outcome: { state: 'unknown', reason: 'provider_ended_before_acknowledgement' }
      }
    ])
  })

  it('leaves the steer unknown when the process exits with neither an echo nor a discard', async () => {
    const h = await setup()
    expect(await promptThenSteer(h)).toEqual({ state: 'admitted' })

    h.connection.exit()
    await h.adapter.drainObservedExits()

    const steer = h.settled.mock.calls
      .map(([settlement]) => settlement)
      .filter((settlement) => settlement.clientMessageId === 'steer-1')
    expect(steer).toEqual([
      {
        sessionId,
        clientMessageId: 'steer-1',
        fence,
        outcome: { state: 'unknown', reason: 'Droid ended before confirming delivery' }
      }
    ])
  })

  it('drops a discard for an unknown id, and does not reopen a steer already accepted', async () => {
    const h = await setup()
    await promptThenSteer(h)
    const requestId = h.connection.lastId
    h.connection.notify({
      type: 'create_message',
      message: { id: 'msg-steer', role: 'user', content: [{ type: 'text', text: 'later' }] },
      requestId
    })
    expect(h.settled).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMessageId: 'steer-1',
        outcome: {
          state: 'accepted',
          providerIdentity: { provider: 'droid', messageId: 'msg-steer' }
        }
      })
    )
    h.settled.mockClear()
    h.warn.mockClear()

    h.connection.notify({
      type: 'queued_messages_discarded',
      requestId,
      text: 'later'
    })
    h.connection.notify({
      type: 'queued_messages_discarded',
      requestId: 'nobody',
      text: 'gone'
    })

    expect(h.settled).not.toHaveBeenCalled()
    expect(h.warn).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(await h.rig.rows())).not.toContain('gone')
  })
})
