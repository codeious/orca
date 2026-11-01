// Recorded Droid hooks (src/shared/__fixtures__/droid-*-hooks.jsonl) posted to the real hook
// server, with the process answers the same logs recorded. Only the process read is faked: the
// probe's verdict rules (zombie, start-time mismatch) and the watch timings are the shipped ones.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProbeModule from '../../shared/agent-process-presence-probe'
import type { AgentProcessObservation } from '../../shared/agent-process-presence-probe'
import {
  invertedSessionEnds,
  loadDroidProbeRuns,
  type DroidProbeFixture,
  type ReplayHook,
  type ReplayRun
} from '../../shared/droid-probe-log-replay.test-fixture'
import { AgentHookServer } from './server'
import { buildBody, PANE, postHookEvent } from './server.test-fixtures'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: () => ({}) }))

const process$ = vi.hoisted(() => ({
  read: async (_pid: number): Promise<AgentProcessObservation> => ({ verdict: 'unverifiable' }),
  probes: 0
}))
// The logs include Linux captures, so the platform comes from the identity rather than this host.
vi.mock('../../shared/agent-process-presence-probe', async (importOriginal) => {
  const actual = await importOriginal<typeof ProbeModule>()
  return {
    ...actual,
    probeAgentProcessPresence: (
      identity: Parameters<typeof actual.probeAgentProcessPresence>[0]
    ) => {
      process$.probes += 1
      return actual.probeAgentProcessPresence(identity, process$.read, identity?.platform)
    }
  }
})

const LOGGED_GAP_MS = 1_000
const SETTLE_AFTER_PROCESS_STEP_MS = 9_000
const servers: AgentHookServer[] = []

beforeEach(() => {
  // Why shouldAdvanceTime: the hooks are real loopback POSTs, which need the clock to move.
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance']
  })
  process$.probes = 0
})

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop()
  }
  vi.useRealTimers()
})

type After = { label: string; ended: boolean; state: string | undefined; probesInGap: number }

const rowOf = (server: AgentHookServer) => server.getStatusSnapshotForPane(PANE)[0]

async function post(server: AgentHookServer, hook: ReplayHook): Promise<void> {
  const response = await postHookEvent(
    server,
    buildBody(hook.payload, hook.process ? { agentProcess: JSON.stringify(hook.process) } : {}),
    '/hook/droid'
  )
  expect(response.status, hook.label).toBe(204)
}

/** Plays the run in log order; the clock moves by the log's own gap between hooks. */
async function play(run: ReplayRun): Promise<{ server: AgentHookServer; after: After[] }> {
  const server = new AgentHookServer()
  servers.push(server)
  await server.start({ env: 'production' })
  // Until the log says otherwise the droid is alive and the probe reads its captured start time.
  const seen = new Map<number, AgentProcessObservation>([
    [run.identity.pid, { verdict: 'live', startTime: run.identity.startTime, zombie: false }]
  ])
  process$.read = async (pid) => seen.get(pid) ?? { verdict: 'exited' }

  const after: After[] = []
  const record = (label: string, probesBefore: number) => {
    const row = rowOf(server)
    after.push({
      label,
      ended: row?.providerSessionOnly === true,
      state: row?.state,
      probesInGap: process$.probes - probesBefore
    })
  }
  for (const [index, step] of run.steps.entries()) {
    if (step.type === 'process') {
      seen.set(step.pid, step.observation)
      const before = process$.probes
      await vi.advanceTimersByTimeAsync(SETTLE_AFTER_PROCESS_STEP_MS)
      record(`process ${step.stage}`, before)
      continue
    }
    await post(server, step)
    const next = run.steps.slice(index + 1).find((candidate) => candidate.type === 'hook')
    const gap =
      next?.type === 'hook' && step.atMs !== null && next.atMs !== null
        ? Math.max(next.atMs - step.atMs, 0)
        : LOGGED_GAP_MS
    const before = process$.probes
    await vi.advanceTimersByTimeAsync(gap)
    record(step.label, before)
  }
  return { server, after }
}

const runsOf = (fixture: DroidProbeFixture) =>
  loadDroidProbeRuns(fixture, { promptForFirstLead: true })
const run = (fixture: DroidProbeFixture, name: string): ReplayRun => {
  const found = runsOf(fixture).find((candidate) => candidate.name === name)
  if (!found) {
    throw new Error(`No run ${name} in ${fixture}`)
  }
  return found
}
const afterLabel = (steps: After[], label: string) => {
  const found = steps.find((step) => step.label === label)
  if (!found) {
    throw new Error(`No step ${label}`)
  }
  return found
}

describe('/new and /resume in the parent-process log (spec 6.3, 6.4)', () => {
  it.each(['tui-0.244.0/t1-new', 'tui-0.238.0/t1-new'])(
    '%s: /new leaves the row working while the droid lives, then its exit ends it',
    async (name) => {
      const { after } = await play(run('droid-parent-process-hooks', name))
      const labels = after.map((step) => step.label)
      const clear = after.find((step) => step.label.includes(' clear'))
      const live = afterLabel(after, 'process after-new')
      const zombie = afterLabel(after, 'process at-end-of-drive')

      // The clear SessionEnd armed a check, which found the process alive.
      expect(clear).toMatchObject({ ended: false, state: 'working' })
      expect(clear?.probesInGap).toBeGreaterThan(0)
      expect(live).toMatchObject({ ended: false, state: 'working' })
      expect(labels.indexOf(live.label)).toBeLessThan(labels.indexOf(zombie.label))
      // `ps` showing the exited droid as <defunct> counts as exited.
      expect(zombie.ended).toBe(true)
    }
  )

  it.each([
    'tui-0.244.0/t2-resume',
    'tui-0.238.0/t2-resume',
    'tui-0.244.0/rep3',
    'tui-0.244.0/rep6',
    'tui-0.238.0/t3-hup'
  ])('%s: a final SessionEnd ends the row only after the process is gone', async (name) => {
    const { after } = await play(run('droid-parent-process-hooks', name))
    const sessionEnd = after.find((step) => step.label.startsWith('SessionEnd'))

    expect(sessionEnd).toMatchObject({ ended: false })
    expect(sessionEnd?.probesInGap).toBeGreaterThan(0)
    expect(after.at(-1)).toMatchObject({ ended: true })
  })

  it.each(['tui-0.244.0/t3-hup', 'tui-0.244.0/rep1', 'tui-0.244.0/rep2'])(
    '%s: a SessionEnd with no earlier hook starts no watch',
    async (name) => {
      const { server, after } = await play(run('droid-parent-process-hooks', name))

      expect(rowOf(server)).toBeUndefined()
      expect(process$.probes).toBe(0)
      expect(after.every((step) => !step.ended)).toBe(true)
    }
  )
})

describe('a SessionStart hook slower than about 10 s (spec 6.4: 124 of 124)', () => {
  const slow = runsOf('droid-slow-start-hooks').map((entry, index): [string, ReplayRun] => [
    `${index} ${entry.name}`,
    entry
  ])

  it.each(slow)(
    '%s: the old SessionEnd other is checked against the live droid and the row survives',
    async (_name, entry) => {
      const { after } = await play(entry)
      const inverted = invertedSessionEnds(entry)

      expect(inverted.length).toBeGreaterThan(0)
      for (const hook of inverted) {
        const watched = afterLabel(after, hook.label)
        expect(watched, hook.label).toMatchObject({ ended: false })
        expect(watched.probesInGap, hook.label).toBeGreaterThan(0)
      }
      // The new lead's start disarms the check: no probe runs in the gap after it.
      for (const [index, step] of after.entries()) {
        if (
          step.label.startsWith('SessionStart') &&
          after[index - 1]?.label.startsWith('SessionEnd')
        ) {
          expect(step.probesInGap, step.label).toBe(0)
        }
      }
      expect(after.some((step) => step.ended)).toBe(false)
    }
  )

  it('counts 124 inverted switches across the slow-start logs', () => {
    const total = runsOf('droid-slow-start-hooks').reduce(
      (sum, entry) => sum + invertedSessionEnds(entry).length,
      0
    )

    expect(total).toBe(124)
  })
})

describe('a late SessionEnd other after the new SessionStart (fast /tree, /resume, two commands)', () => {
  const late = [...runsOf('droid-tree-resume-hooks'), ...runsOf('droid-two-command-hooks')].map(
    (entry, index): [string, ReplayRun] => [`${index} ${entry.name}`, entry]
  )

  it.each(late)(
    '%s: a SessionEnd naming a replaced session starts no check; only the last one, the lead exiting, does',
    async (_name, entry) => {
      const { after } = await play(entry)
      const last = after.at(-1)

      expect(last?.label).toMatch(/^SessionEnd/)
      expect(last?.probesInGap).toBeGreaterThan(0)
      expect(after.slice(0, -1).filter((step) => step.probesInGap !== 0)).toEqual([])
      // Nothing in these logs says the droid exited, so the probe keeps reading it live.
      expect(after.some((step) => step.ended)).toBe(false)
    }
  )
})
