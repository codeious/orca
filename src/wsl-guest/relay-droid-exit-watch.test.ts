// A Droid SessionEnd does not say whether the process exited, so the guest relay (which owns the
// process on WSL) confirms with the process itself before it publishes the row as ended.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RetrySchedulerModule from './agent-hook-result-retry-scheduler'
import type { AgentHookResultRetryHost } from './agent-hook-result-retry-scheduler'
import { RelayAgentHookServer } from './agent-hook-server'
import type { AgentHookRelayEnvelope } from '../shared/agent-hook-relay'
import { makePaneKey } from '../shared/stable-pane-id'

const probe = vi.hoisted(() =>
  vi.fn(async (): Promise<'live' | 'unverifiable' | 'exited'> => 'live')
)
vi.mock('../shared/agent-process-presence-probe', () => ({ probeAgentProcessPresence: probe }))
const retryHosts = vi.hoisted(() => {
  const hosts: AgentHookResultRetryHost[] = []
  return hosts
})
vi.mock('./agent-hook-result-retry-scheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof RetrySchedulerModule>()
  return {
    AgentHookResultRetryScheduler: class extends actual.AgentHookResultRetryScheduler {
      constructor(host: AgentHookResultRetryHost) {
        super(host)
        retryHosts.push(host)
      }
    }
  }
})

const OWNER = 4242
const NESTED = 5151
const LEAD = 'lead-session'
const paneKey = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')
let dir: string
let forward: ReturnType<typeof vi.fn<(envelope: AgentHookRelayEnvelope) => void>>
const servers: RelayAgentHookServer[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-droid-exit-'))
  forward = vi.fn<(envelope: AgentHookRelayEnvelope) => void>()
  // Why shouldAdvanceTime: the hooks are real loopback POSTs, which need the clock to move.
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance']
  })
})

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop()
  }
  retryHosts.length = 0
  probe.mockReset()
  probe.mockResolvedValue('live')
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

function identity(pid: number): string {
  return JSON.stringify({ pid, platform: process.platform, startTime: `birth-${pid}` })
}

async function startRelay(): Promise<RelayAgentHookServer> {
  const server = new RelayAgentHookServer({ endpointDir: dir, forward })
  servers.push(server)
  await server.start()
  return server
}

async function droid(
  server: RelayAgentHookServer,
  event: string,
  fields: Record<string, unknown> = {},
  pid: number | null = OWNER
): Promise<void> {
  const { port, token } = server.getCoordinates()
  const response = await fetch(`http://127.0.0.1:${port}/hook/droid`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Why: Node 24's fetch arms its keep-alive and connect timers on the faked clock, which
      // would be counted as a leak of the relay's own.
      Connection: 'close',
      'X-Orca-Agent-Hook-Token': token
    },
    body: JSON.stringify({
      paneKey,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      ...(pid === null ? {} : { agentProcess: identity(pid) }),
      payload: {
        hook_event_name: event,
        session_id: LEAD,
        ...(event === 'UserPromptSubmit' ? { prompt: 'fix the build' } : {}),
        ...fields
      }
    })
  })
  expect(response.status).toBe(204)
}

const last = () => forward.mock.lastCall?.[0]
const endedEnvelopes = () => forward.mock.calls.filter(([e]) => e.agentPresence?.ended)

async function working(): Promise<RelayAgentHookServer> {
  const server = await startRelay()
  await droid(server, 'SessionStart')
  await droid(server, 'UserPromptSubmit')
  return server
}

describe('Droid exit watch on the guest relay', () => {
  it('publishes the row as ended only once a probe confirms the process exited', async () => {
    const server = await working()
    probe.mockResolvedValueOnce('live').mockResolvedValueOnce('exited')

    await droid(server, 'SessionEnd', { reason: 'prompt_input_exit' })
    expect(last()?.payload.state).toBe('working')
    expect(probe).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)
    expect(probe).toHaveBeenCalledOnce()
    expect(endedEnvelopes()).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(500)
    expect(probe).toHaveBeenCalledTimes(2)
    expect(last()).toMatchObject({
      hookEventName: 'AgentProcessExit',
      providerSessionOnly: true,
      providerSession: { id: LEAD },
      agentPresence: { ended: true }
    })
  })

  it.each(['other', 'clear', 'prompt_input_exit', 'logout'])(
    'watches after a %s SessionEnd and leaves a process that is still running alone',
    async (reason) => {
      const server = await working()

      await droid(server, 'SessionEnd', { reason })
      await vi.advanceTimersByTimeAsync(120_000)

      expect(probe.mock.calls.length).toBeGreaterThan(5)
      expect(endedEnvelopes()).toHaveLength(0)
      expect(last()?.payload.state).toBe('working')
    }
  )

  it('never publishes an end on an unanswered read', async () => {
    const server = await working()
    probe.mockResolvedValue('unverifiable')

    await droid(server, 'SessionEnd', { reason: 'other' })
    await vi.advanceTimersByTimeAsync(120_000)

    expect(endedEnvelopes()).toHaveLength(0)
  })

  it('stops when the lead starts a new session', async () => {
    const server = await working()

    await droid(server, 'SessionEnd', { reason: 'clear' })
    await droid(server, 'SessionStart', { session_id: 'next-lead' })
    await vi.advanceTimersByTimeAsync(120_000)

    expect(probe).not.toHaveBeenCalled()
  })

  it('stops when the lead starts again under the same session id', async () => {
    const server = await working()

    await droid(server, 'SessionEnd', { reason: 'other' })
    await droid(server, 'SessionStart', { source: 'resume' })
    await vi.advanceTimersByTimeAsync(120_000)

    expect(probe).not.toHaveBeenCalled()
  })

  it('stops when the same lead carries on after its SessionEnd', async () => {
    const server = await working()

    await droid(server, 'SessionEnd', { reason: 'other' })
    await droid(server, 'UserPromptSubmit')
    await vi.advanceTimersByTimeAsync(120_000)

    expect(probe).not.toHaveBeenCalled()
  })

  it('stops with the server', async () => {
    const server = await working()

    await droid(server, 'SessionEnd', { reason: 'other' })
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    server.stop()

    // Why: stop() also clears the marker, so only a released timer shows the watch itself stopped.
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(probe).not.toHaveBeenCalled()
  })

  it('stops when the pane is cleared', async () => {
    const server = await working()

    await droid(server, 'SessionEnd', { reason: 'other' })
    server.clearPaneState(paneKey)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(probe).not.toHaveBeenCalled()
  })

  it('does not watch a SessionEnd that carries no process identity', async () => {
    const server = await startRelay()
    await droid(server, 'SessionStart', {}, null)
    await droid(server, 'UserPromptSubmit', {}, null)

    await droid(server, 'SessionEnd', { reason: 'other' }, null)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(probe).not.toHaveBeenCalled()
  })

  it('does not start a watch from another process ending, only the one check it owes the owner', async () => {
    const server = await working()

    await droid(server, 'SessionEnd', { reason: 'other' }, NESTED)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(probe).toHaveBeenCalledOnce()
  })

  describe('with a SessionEnd replayed from the spool', () => {
    function spoolEndedLead(): void {
      const spoolDir = join(dir, 'spool')
      mkdirSync(spoolDir)
      const record = (hookEventName: string, fields: Record<string, unknown> = {}) =>
        JSON.stringify({
          paneKey,
          tabId: 'tab-1',
          worktreeId: 'wt-1',
          env: 'remote',
          version: '1',
          source: 'droid',
          hookEventName,
          agentProcess: identity(OWNER),
          payload: { hook_event_name: hookEventName, session_id: LEAD, ...fields },
          receivedAt: Date.now()
        })
      writeFileSync(
        join(spoolDir, 'pane-droid.jsonl'),
        [
          record('SessionStart'),
          record('UserPromptSubmit', { prompt: 'fix the build' }),
          record('SessionEnd', { reason: 'other' })
        ]
          .map((line) => `${line}\n`)
          .join('')
      )
    }

    it('does not start a watch', async () => {
      spoolEndedLead()

      await startRelay()
      await vi.advanceTimersByTimeAsync(120_000)

      expect(forward.mock.calls.map(([e]) => e.hookEventName)).toContain('SessionEnd')
      expect(probe).not.toHaveBeenCalled()
    })

    it('does not start one when a late result is retried onto that row', async () => {
      spoolEndedLead()
      await startRelay()
      const retryHost = retryHosts[0]
      const cached = retryHost.state.lastStatusByPaneKey.get(paneKey)
      if (!cached) {
        throw new Error('missing replayed row')
      }

      retryHost.applyEvent(
        { ...cached, payload: { ...cached.payload, lastAssistantMessage: 'late result' } },
        'droid'
      )
      await vi.advanceTimersByTimeAsync(120_000)

      expect(last()?.payload.lastAssistantMessage).toBe('late result')
      expect(probe).not.toHaveBeenCalled()
    })
  })
})
