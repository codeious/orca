// A Droid SessionEnd does not say whether the process exited (`/clear` and `/new` end a session
// too), so the host confirms with the process itself before it ends the row.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer } from './server'
import { buildBody, PANE, postHookEvent } from './server.test-fixtures'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: () => ({}) }))

const probe = vi.hoisted(() =>
  vi.fn(async (): Promise<'live' | 'unverifiable' | 'exited'> => 'live')
)
vi.mock('../../shared/agent-process-presence-probe', () => ({ probeAgentProcessPresence: probe }))

const OWNER = 4242
const NESTED = 5151
const LEAD = 'lead-session'
const CHILD = 'child-session'
const servers: AgentHookServer[] = []

beforeEach(() => {
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
  probe.mockReset()
  probe.mockResolvedValue('live')
  vi.useRealTimers()
})

async function startServer(userDataPath?: string): Promise<AgentHookServer> {
  const server = new AgentHookServer()
  servers.push(server)
  await server.start({ env: 'production', ...(userDataPath ? { userDataPath } : {}) })
  return server
}

function identity(pid: number): string {
  return JSON.stringify({ pid, platform: process.platform, startTime: `birth-${pid}` })
}

async function droid(
  server: AgentHookServer,
  event: string,
  fields: Record<string, unknown> = {},
  pid: number | null = OWNER
): Promise<void> {
  const response = await postHookEvent(
    server,
    buildBody(
      {
        hook_event_name: event,
        session_id: LEAD,
        ...(event === 'UserPromptSubmit' ? { prompt: 'fix the build' } : {}),
        ...fields
      },
      pid === null ? {} : { agentProcess: identity(pid) }
    ),
    '/hook/droid'
  )
  expect(response.status).toBe(204)
}

const row = (server: AgentHookServer) => server.getStatusSnapshotForPane(PANE)[0]

async function working(): Promise<AgentHookServer> {
  const server = await startServer()
  await droid(server, 'SessionStart')
  await droid(server, 'UserPromptSubmit')
  return server
}

describe('Droid exit watch on the hook server', () => {
  it('ends the row only once a probe confirms the process exited', async () => {
    const server = await working()
    probe.mockResolvedValueOnce('live').mockResolvedValueOnce('exited')

    await droid(server, 'SessionEnd', { reason: 'prompt_input_exit' })
    expect(row(server)).toMatchObject({ state: 'working' })
    expect(probe).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)
    expect(probe).toHaveBeenCalledOnce()
    expect(row(server)).toMatchObject({ state: 'working' })

    await vi.advanceTimersByTimeAsync(500)
    expect(probe).toHaveBeenCalledTimes(2)
    expect(row(server)).toMatchObject({ providerSessionOnly: true, providerSession: { id: LEAD } })
    expect(server.hasVerifiableAgentProcess(PANE)).toBe(false)
  })

  it.each(['other', 'clear', 'prompt_input_exit', 'logout'])(
    'watches after a %s SessionEnd and leaves a process that is still running alone',
    async (reason) => {
      const server = await working()

      await droid(server, 'SessionEnd', { reason })
      await vi.advanceTimersByTimeAsync(120_000)

      expect(probe.mock.calls.length).toBeGreaterThan(5)
      expect(row(server)).toMatchObject({ state: 'working' })
      expect(row(server).providerSessionOnly).toBeUndefined()
    }
  )

  it('never ends a row on an unanswered read', async () => {
    const server = await working()
    probe.mockResolvedValue('unverifiable')

    await droid(server, 'SessionEnd', { reason: 'other' })
    await vi.advanceTimersByTimeAsync(120_000)

    expect(row(server)).toMatchObject({ state: 'working' })
  })

  it('stops when the lead speaks again, as a cleared or resumed session does', async () => {
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

  it('keeps watching through a late hook from a child of the ending process', async () => {
    const server = await working()
    await droid(server, 'SessionStart', { session_id: CHILD, calling_session_id: LEAD })
    await droid(server, 'UserPromptSubmit', { session_id: CHILD })
    probe.mockResolvedValue('exited')

    await droid(server, 'SessionEnd', { reason: 'prompt_input_exit' })
    await droid(server, 'Stop', { session_id: CHILD })
    await vi.advanceTimersByTimeAsync(250)

    expect(probe).toHaveBeenCalledOnce()
    expect(row(server)).toMatchObject({ providerSessionOnly: true })
  })

  it('stops with the server', async () => {
    const server = await working()

    await droid(server, 'SessionEnd', { reason: 'prompt_input_exit' })
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    server.stop()

    // Why: stop() also clears the marker, so only a released timer shows the watch itself stopped.
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(probe).not.toHaveBeenCalled()
  })

  it('stops when the pane is cleared', async () => {
    const server = await working()

    await droid(server, 'SessionEnd', { reason: 'prompt_input_exit' })
    server.clearPaneState(PANE)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(probe).not.toHaveBeenCalled()
  })

  it('does not watch a SessionEnd that carries no process identity', async () => {
    const server = await startServer()
    await droid(server, 'SessionStart', {}, null)
    await droid(server, 'UserPromptSubmit', {}, null)

    await droid(server, 'SessionEnd', { reason: 'prompt_input_exit' }, null)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(probe).not.toHaveBeenCalled()
    expect(row(server)).toMatchObject({ state: 'working' })
  })

  it('does not start a watch from another process ending, only the one check it owes the owner', async () => {
    const server = await working()

    await droid(server, 'SessionEnd', { reason: 'prompt_input_exit' }, NESTED)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(probe).toHaveBeenCalledOnce()
    expect(row(server)).toMatchObject({ state: 'working' })
  })

  it('does not start a watch from replayed spool records', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-droid-exit-spool-'))
    const first = await startServer(userDataPath)
    await droid(first, 'SessionStart')
    first.flushStatusPersistSync()
    first.stop()
    const spoolDir = join(userDataPath, 'agent-hooks', 'spool')
    mkdirSync(spoolDir, { recursive: true })
    const records = ['SessionStart', 'UserPromptSubmit', 'SessionEnd'].map((hook_event_name) =>
      JSON.stringify({
        paneKey: PANE,
        source: 'droid',
        receivedAt: Date.now(),
        agentProcess: identity(OWNER),
        payload: { hook_event_name, session_id: LEAD, prompt: 'fix the build', reason: 'other' }
      })
    )
    writeFileSync(join(spoolDir, 'pane-spooled.jsonl'), `${records.join('\n')}\n`)
    probe.mockClear()

    await startServer(userDataPath)
    await vi.advanceTimersByTimeAsync(120_000)

    // The one check after a restart replays what the pane owes; a watch would add many more.
    expect(probe.mock.calls.length).toBeLessThanOrEqual(1)
  })
})
