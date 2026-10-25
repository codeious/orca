// Which terminal pane, if any, holds a Droid session: a pane row carrying the id whose `droid`
// process is not proven exited. A row alone is not proof; Orca keeps a dismissed row's id for resume.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePaneKey } from '../../shared/stable-pane-id'
import { AgentHookServer } from './server'
import { buildBody, LEAF_2, PANE, postHookEvent } from './server.test-fixtures'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: () => ({}) }))

const probe = vi.hoisted(() =>
  vi.fn(async (_target: { pid: number }): Promise<'live' | 'unverifiable' | 'exited'> => 'live')
)
vi.mock('../../shared/agent-process-presence-probe', () => ({ probeAgentProcessPresence: probe }))

const SESSION = 'held-session'
const OTHER_PANE = makePaneKey('tab-2', LEAF_2)
const servers: AgentHookServer[] = []

beforeEach(() => {
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

async function startServer(): Promise<AgentHookServer> {
  const server = new AgentHookServer()
  servers.push(server)
  await server.start({ env: 'production' })
  return server
}

function identity(pid: number): string {
  return JSON.stringify({ pid, platform: process.platform, startTime: `birth-${pid}` })
}

async function holderOf(server: AgentHookServer): Promise<unknown> {
  return (await server.droidSessionHolder(SESSION)).holder
}

async function hook(
  server: AgentHookServer,
  event: string,
  options: {
    pane?: string
    pid?: number | null
    source?: 'droid' | 'claude'
    session?: string
    fields?: Record<string, unknown>
  } = {}
): Promise<void> {
  const { pane = PANE, pid = 4242, source = 'droid', session = SESSION, fields = {} } = options
  const response = await postHookEvent(
    server,
    buildBody(
      {
        hook_event_name: event,
        session_id: session,
        ...(event === 'UserPromptSubmit' ? { prompt: 'fix the build' } : {}),
        ...fields
      },
      {
        paneKey: pane,
        tabId: pane === OTHER_PANE ? 'tab-2' : 'tab-1',
        ...(pid === null ? {} : { agentProcess: identity(pid) })
      }
    ),
    `/hook/${source}`
  )
  expect(response.status).toBe(204)
}

describe('the pane that holds a Droid session', () => {
  it('is live while the process answers, whether the agent is working or idle', async () => {
    const server = await startServer()
    await hook(server, 'SessionStart')
    await hook(server, 'UserPromptSubmit')
    await hook(server, 'Stop')

    await expect(holderOf(server)).resolves.toBe('live')
  })

  it('is unverifiable when the process cannot be read', async () => {
    const server = await startServer()
    await hook(server, 'UserPromptSubmit')
    probe.mockResolvedValue('unverifiable')

    await expect(holderOf(server)).resolves.toBe('unverifiable')
  })

  it('is unverifiable when the row carries no process identity, so Resume asks', async () => {
    const server = await startServer()
    await hook(server, 'UserPromptSubmit', { pid: null })

    await expect(holderOf(server)).resolves.toBe('unverifiable')
    expect(probe).not.toHaveBeenCalled()
  })

  it('holds a resumed session before its first prompt, when the pane has no row yet', async () => {
    const server = await startServer()
    await hook(server, 'SessionStart', { fields: { source: 'resume' } })

    // No row means no captured process to read, so the host cannot call it free or held.
    await expect(holderOf(server)).resolves.toBe('unverifiable')
    expect(probe).not.toHaveBeenCalled()
  })

  it('reads the process once the first prompt gives the pane a row', async () => {
    const server = await startServer()
    await hook(server, 'SessionStart', { fields: { source: 'resume' } })
    await hook(server, 'UserPromptSubmit')

    await expect(holderOf(server)).resolves.toBe('live')
  })

  it('holds nothing once the process is proven exited, though the row keeps the id for resume', async () => {
    const server = await startServer()
    await hook(server, 'SessionStart')
    await hook(server, 'UserPromptSubmit')
    probe.mockResolvedValue('exited')

    await expect(holderOf(server)).resolves.toBeNull()
    // The row is now ended, and a later question needs no second probe.
    probe.mockClear()
    await expect(holderOf(server)).resolves.toBeNull()
    expect(probe).not.toHaveBeenCalled()
  })

  it('lets a live pane outrank an unverifiable one', async () => {
    const server = await startServer()
    await hook(server, 'UserPromptSubmit', { pane: PANE, pid: 4242 })
    await hook(server, 'UserPromptSubmit', { pane: OTHER_PANE, pid: 5151 })
    probe.mockImplementation(async () => (probe.mock.calls.length === 1 ? 'unverifiable' : 'live'))

    await expect(holderOf(server)).resolves.toBe('live')
  })

  describe('on an SSH host', () => {
    const remote = {
      paneKey: PANE,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      source: 'droid',
      hookEventName: 'UserPromptSubmit',
      providerSession: { key: 'session_id', id: SESSION },
      agentPresence: {
        agent: 'droid',
        process: { pid: 4242, platform: 'linux', startTime: 'remote-birth' }
      },
      payload: { state: 'working', prompt: 'remote task', agentType: 'droid' }
    }

    it('is unverifiable, and never probes the remote PID on this machine', async () => {
      const server = await startServer()
      server.ingestRemote(remote, 'ssh-1')

      await expect(holderOf(server)).resolves.toBe('unverifiable')
      expect(probe).not.toHaveBeenCalled()
    })

    it('holds nothing once the relay reports that process exited', async () => {
      const server = await startServer()
      server.ingestRemote(remote, 'ssh-1')

      server.ingestRemote(
        {
          ...remote,
          hookEventName: 'AgentProcessExit',
          providerSessionOnly: true,
          agentPresence: { ...remote.agentPresence, ended: true }
        },
        'ssh-1'
      )

      await expect(holderOf(server)).resolves.toBeNull()
    })

    it('stays held when an exit report does not name the holder process', async () => {
      const server = await startServer()
      server.ingestRemote(remote, 'ssh-1')

      server.ingestRemote(
        {
          ...remote,
          hookEventName: 'AgentProcessExit',
          providerSessionOnly: true,
          agentPresence: { agent: 'droid', ended: true }
        },
        'ssh-1'
      )

      await expect(holderOf(server)).resolves.toBe('unverifiable')
    })
  })

  it('does not look at panes holding another session', async () => {
    const server = await startServer()
    await hook(server, 'SessionStart', { session: 'someone-elses' })

    await expect(holderOf(server)).resolves.toBeNull()
    expect(probe).not.toHaveBeenCalled()
  })

  it('does not hold a session for a pane another agent has since taken over', async () => {
    const server = await startServer()
    await hook(server, 'SessionStart')
    await hook(server, 'UserPromptSubmit', {
      source: 'claude',
      session: 'claude-session',
      pid: 5151
    })

    await expect(holderOf(server)).resolves.toBeNull()
  })

  it('does not count another agent that happens to share the id', async () => {
    const server = await startServer()
    await hook(server, 'UserPromptSubmit', { source: 'claude' })

    await expect(holderOf(server)).resolves.toBeNull()
  })
})

describe('the panes named as holding a Droid session', () => {
  it('names the pane that holds it, with what its own process says', async () => {
    const server = await startServer()
    await hook(server, 'UserPromptSubmit')

    await expect(server.droidSessionHolder(SESSION)).resolves.toEqual({
      holder: 'live',
      panes: [{ paneKey: PANE, verdict: 'live' }]
    })
  })

  it('gives each pane its own verdict rather than the aggregate one', async () => {
    const server = await startServer()
    await hook(server, 'UserPromptSubmit', { pane: PANE, pid: 4242 })
    await hook(server, 'UserPromptSubmit', { pane: OTHER_PANE, pid: 5151 })
    probe.mockImplementation(async (target) => (target.pid === 5151 ? 'live' : 'unverifiable'))

    const answer = await server.droidSessionHolder(SESSION)

    expect(answer.holder).toBe('live')
    expect(answer.panes).toHaveLength(2)
    expect(answer.panes).toContainEqual({ paneKey: PANE, verdict: 'unverifiable' })
    expect(answer.panes).toContainEqual({ paneKey: OTHER_PANE, verdict: 'live' })
  })

  it('leaves out a pane whose process is proven exited', async () => {
    const server = await startServer()
    await hook(server, 'UserPromptSubmit', { pane: PANE, pid: 4242 })
    await hook(server, 'UserPromptSubmit', { pane: OTHER_PANE, pid: 5151 })
    probe.mockImplementation(async (target) => (target.pid === 4242 ? 'exited' : 'live'))

    await expect(server.droidSessionHolder(SESSION)).resolves.toEqual({
      holder: 'live',
      panes: [{ paneKey: OTHER_PANE, verdict: 'live' }]
    })
  })

  it('names no pane when nothing holds it', async () => {
    const server = await startServer()
    await hook(server, 'UserPromptSubmit')
    probe.mockResolvedValue('exited')

    await expect(server.droidSessionHolder(SESSION)).resolves.toEqual({ holder: null, panes: [] })
  })

  it('names a resumed pane that has no row yet, as unverifiable', async () => {
    const server = await startServer()
    await hook(server, 'SessionStart', { fields: { source: 'resume' } })

    await expect(server.droidSessionHolder(SESSION)).resolves.toEqual({
      holder: 'unverifiable',
      panes: [{ paneKey: PANE, verdict: 'unverifiable' }]
    })
  })

  it('names an SSH pane as unverifiable without probing it here', async () => {
    const server = await startServer()
    server.ingestRemote(
      {
        paneKey: PANE,
        tabId: 'tab-1',
        worktreeId: 'wt-1',
        source: 'droid',
        hookEventName: 'UserPromptSubmit',
        providerSession: { key: 'session_id', id: SESSION },
        agentPresence: {
          agent: 'droid',
          process: { pid: 4242, platform: 'linux', startTime: 'remote-birth' }
        },
        payload: { state: 'working', prompt: 'remote task', agentType: 'droid' }
      },
      'ssh-1'
    )

    await expect(server.droidSessionHolder(SESSION)).resolves.toEqual({
      holder: 'unverifiable',
      panes: [{ paneKey: PANE, verdict: 'unverifiable' }]
    })
    expect(probe).not.toHaveBeenCalled()
  })
})
