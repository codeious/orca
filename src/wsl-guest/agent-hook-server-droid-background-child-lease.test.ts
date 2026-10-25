// The relay owns a remote pane's Droid records, so it, not the desktop, must restate a pane that a
// background child's Stop left working when the lead never wakes. The lease is the host's own
// judgement (spec 6.5), not something the research logs recorded.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentHookRelayEnvelope } from '../shared/agent-hook-relay'
import { DROID_BACKGROUND_CHILD_LEASE_MS } from '../shared/agent-hook-listener/providers/droid-session-status'
import { makePaneKey } from '../shared/stable-pane-id'
import { RelayAgentHookServer } from './agent-hook-server'

const PANE_KEY = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')
const LEAD = 'lead-session'
const CHILD = 'child-session'

describe('Droid background child lease on the relay', () => {
  let dir: string
  let forward: ReturnType<typeof vi.fn<(envelope: AgentHookRelayEnvelope) => void>>
  const servers: RelayAgentHookServer[] = []
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'relay-droid-lease-'))
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
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  async function stoppedLeadWithFinishedBackgroundChild() {
    const server = new RelayAgentHookServer({ endpointDir: dir, forward })
    servers.push(server)
    await server.start()
    const { port, token } = server.getCoordinates()
    const post = async (payload: Record<string, unknown>) => {
      const response = await fetch(`http://127.0.0.1:${port}/hook/droid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': token },
        body: JSON.stringify({ paneKey: PANE_KEY, tabId: 'tab-1', worktreeId: 'wt-1', payload })
      })
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
    return { server, post }
  }

  const last = () => forward.mock.lastCall?.[0]

  it('forwards the settled row once the lease runs out with no further hook', async () => {
    await stoppedLeadWithFinishedBackgroundChild()
    expect(last()?.payload.state).toBe('working')
    const forwarded = forward.mock.calls.length

    await vi.advanceTimersByTimeAsync(DROID_BACKGROUND_CHILD_LEASE_MS - 1)
    expect(forward.mock.calls).toHaveLength(forwarded)
    await vi.advanceTimersByTimeAsync(1)

    expect(last()).toMatchObject({ paneKey: PANE_KEY, payload: { state: 'done' } })
  })

  it('forwards nothing when the lead speaks inside the lease', async () => {
    const { post } = await stoppedLeadWithFinishedBackgroundChild()

    await vi.advanceTimersByTimeAsync(DROID_BACKGROUND_CHILD_LEASE_MS - 1)
    await post({ hook_event_name: 'UserPromptSubmit', session_id: LEAD, prompt: 'continue' })
    await vi.advanceTimersByTimeAsync(DROID_BACKGROUND_CHILD_LEASE_MS)

    expect(last()?.payload).toMatchObject({ state: 'working', prompt: 'continue' })
  })

  it('cancels the wakeup when the relay stops', async () => {
    const { server } = await stoppedLeadWithFinishedBackgroundChild()
    const forwarded = forward.mock.calls.length

    server.stop()
    await vi.advanceTimersByTimeAsync(DROID_BACKGROUND_CHILD_LEASE_MS * 3)

    expect(forward.mock.calls).toHaveLength(forwarded)
  })
})
