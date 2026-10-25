// A background child's Stop can be the last hook of a turn: nothing arrives to say the lead never
// woke, so the server restates the row itself when the lease runs out. The lease is the host's own
// judgement (spec 6.5), not something the research logs recorded.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DROID_BACKGROUND_CHILD_LEASE_MS } from '../../shared/agent-hook-listener/providers/droid-session-status'
import { AgentHookServer } from './server'
import { buildBody, PANE, postHookEvent } from './server.test-fixtures'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: () => ({}) }))

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
  vi.useRealTimers()
})

async function stoppedLeadWithFinishedBackgroundChild() {
  const server = new AgentHookServer()
  servers.push(server)
  await server.start({ env: 'production' })
  const states: string[] = []
  server.setListener((event) => states.push(event.payload.state))
  const post = async (payload: Record<string, unknown>) => {
    const response = await postHookEvent(server, buildBody(payload), '/hook/droid')
    expect(response.status).toBe(204)
  }
  await post({ hook_event_name: 'SessionStart', session_id: LEAD, source: 'startup' })
  await post({ hook_event_name: 'UserPromptSubmit', session_id: LEAD, prompt: 'run it' })
  await post({ hook_event_name: 'PreToolUse', session_id: LEAD, tool_name: 'Task' })
  await post({
    hook_event_name: 'SessionStart',
    session_id: CHILD,
    source: 'startup',
    calling_session_id: LEAD
  })
  await post({ hook_event_name: 'UserPromptSubmit', session_id: CHILD, prompt: 'child task' })
  await post({ hook_event_name: 'Stop', session_id: LEAD })
  await post({ hook_event_name: 'Stop', session_id: CHILD })
  return { server, post, states, row: () => server.getStatusSnapshotForPane(PANE)[0] }
}

describe('Droid background child lease on the hook server', () => {
  it('settles a row held open only by the lease once it runs out', async () => {
    const { row, states } = await stoppedLeadWithFinishedBackgroundChild()
    expect(row()).toMatchObject({ state: 'working' })

    await vi.advanceTimersByTimeAsync(DROID_BACKGROUND_CHILD_LEASE_MS - 1)
    expect(row()).toMatchObject({ state: 'working' })
    await vi.advanceTimersByTimeAsync(1)

    expect(row()).toMatchObject({ state: 'done' })
    expect(states.at(-1)).toBe('done')
  })

  it('leaves the row alone when the lead speaks inside the lease', async () => {
    const { post, row } = await stoppedLeadWithFinishedBackgroundChild()

    await vi.advanceTimersByTimeAsync(DROID_BACKGROUND_CHILD_LEASE_MS - 1)
    await post({ hook_event_name: 'UserPromptSubmit', session_id: LEAD, prompt: 'continue' })
    await vi.advanceTimersByTimeAsync(DROID_BACKGROUND_CHILD_LEASE_MS)

    expect(row()).toMatchObject({ state: 'working', prompt: 'continue' })
  })

  it('arms nothing for a foreground child that finishes while the lead works', async () => {
    const server = new AgentHookServer()
    servers.push(server)
    await server.start({ env: 'production' })
    const states: string[] = []
    server.setListener((event) => states.push(event.payload.state))
    const post = (payload: Record<string, unknown>) =>
      postHookEvent(server, buildBody(payload), '/hook/droid')
    await post({ hook_event_name: 'SessionStart', session_id: LEAD, source: 'startup' })
    await post({ hook_event_name: 'UserPromptSubmit', session_id: LEAD, prompt: 'run it' })
    await post({
      hook_event_name: 'SessionStart',
      session_id: CHILD,
      source: 'startup',
      calling_session_id: LEAD
    })
    await post({ hook_event_name: 'UserPromptSubmit', session_id: CHILD, prompt: 'child task' })
    await post({ hook_event_name: 'Stop', session_id: CHILD })
    const published = states.length

    await vi.advanceTimersByTimeAsync(DROID_BACKGROUND_CHILD_LEASE_MS * 3)

    expect(states).toHaveLength(published)
    expect(server.getStatusSnapshotForPane(PANE)[0]).toMatchObject({ state: 'working' })
  })

  it('cancels the wakeup when the server stops', async () => {
    const { server, states } = await stoppedLeadWithFinishedBackgroundChild()
    const published = states.length

    server.stop()
    await vi.advanceTimersByTimeAsync(DROID_BACKGROUND_CHILD_LEASE_MS * 3)

    expect(states).toHaveLength(published)
  })
})
