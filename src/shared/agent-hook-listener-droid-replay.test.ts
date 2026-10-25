// Recorded Droid hooks (src/shared/__fixtures__/droid-*-hooks.jsonl, from the research probes)
// replayed through the listener. Each test states the spec 6.3-6.5 rule it checks. Only the
// first prompt of a pane is added (the probes sent none), and every other hook is the log's.
import { describe, expect, it } from 'vitest'
import type { AgentHookEventPayload } from './agent-hook-listener/listener-event'
import { droidExitMarker } from './agent-hook-listener/providers/droid-sessions'
import { DROID_BACKGROUND_CHILD_LEASE_MS } from './agent-hook-listener/providers/droid-session-status'
import { createDroidHookDriver, type DroidHookDriver } from './agent-hook-listener-droid-driver'
import { PANE_KEY } from './agent-hook-listener-test-harness'
import {
  hooksOf,
  invertedSessionEnds,
  loadDroidProbeRuns,
  type DroidProbeFixture,
  type ReplayHook,
  type ReplayRun
} from './droid-probe-log-replay.test-fixture'

type Replayed = {
  hook: ReplayHook
  event: AgentHookEventPayload | null
  leadBefore: string | undefined
  leadAfter: string | undefined
  /** Whether the lead's SessionEnd is pending an exit confirmation after this hook. */
  watching: boolean
}

const leadOf = (driver: DroidHookDriver) =>
  driver.state.droidSessionsByPaneKey.get(PANE_KEY)?.leadId

function replay(run: ReplayRun): { driver: DroidHookDriver; steps: Replayed[] } {
  const driver = createDroidHookDriver()
  const steps = hooksOf(run).map((hook) => {
    const leadBefore = leadOf(driver)
    const event = driver.hook(hook.payload, hook.process)
    return {
      hook,
      event,
      leadBefore,
      leadAfter: leadOf(driver),
      watching: droidExitMarker(driver.state, PANE_KEY) !== undefined
    }
  })
  return { driver, steps }
}

const runs = (fixture: DroidProbeFixture) =>
  loadDroidProbeRuns(fixture, { promptForFirstLead: true }).map((run) => [run.name, run] as const)
const named = (fixture: DroidProbeFixture, name: string): ReplayRun => {
  const run = loadDroidProbeRuns(fixture, { promptForFirstLead: true }).find((r) => r.name === name)
  if (!run) {
    throw new Error(`No run ${name} in ${fixture}`)
  }
  return run
}
const at = (steps: Replayed[], label: string, occurrence = 0): Replayed => {
  const found = steps.filter((step) => step.hook.label === label)[occurrence]
  if (!found) {
    throw new Error(`No ${label} #${occurrence}`)
  }
  return found
}
const subagentIds = (driver: DroidHookDriver) =>
  (driver.row()?.payload.subagents ?? []).map((child) => child.id)

describe('process identity in the parent-process log (spec 6.3)', () => {
  const replacedRuns = runs('droid-parent-process-hooks').filter(([, run]) =>
    hooksOf(run).some((hook) => hook.payload.hook_event_name === 'SessionStart')
  )

  it.each(replacedRuns)('%s: the row is owned by the droid the hook captured', (_name, run) => {
    const { driver, steps } = replay(run)

    const identified = steps.filter((step) => step.event?.agentPresence)
    expect(identified.length).toBeGreaterThan(0)
    for (const step of identified) {
      expect(step.event?.agentPresence?.process, step.hook.label).toEqual(run.identity)
    }
    expect(driver.row()?.agentPresence?.process).toEqual(run.identity)
  })

  it('keeps one identity across /new', () => {
    const { driver } = replay(named('droid-parent-process-hooks', 'tui-0.244.0/t1-new'))

    expect(driver.row()?.agentPresence?.process).toEqual({
      pid: 72774,
      platform: 'darwin',
      startTime: 'Sat Oct 17 14:26:43 2026'
    })
  })

  it('reads a Linux capture the same way', () => {
    const { driver } = replay(named('droid-parent-process-hooks', 'linux-0.244.0/s1-init'))

    expect(driver.row()?.agentPresence?.process).toMatchObject({ pid: 421, platform: 'linux' })
  })

  it.each(['tui-0.244.0/t3-hup', 'tui-0.244.0/rep1', 'tui-0.244.0/rep2'])(
    '%s: a SessionEnd with no earlier hook of the pane makes no row and starts no exit watch',
    (name) => {
      const { driver, steps } = replay(named('droid-parent-process-hooks', name))

      expect(steps.map((step) => step.hook.payload.hook_event_name)).toEqual(['SessionEnd'])
      expect(steps[0].event).toBeNull()
      expect(driver.row()).toBeUndefined()
      expect(droidExitMarker(driver.state, PANE_KEY)).toBeUndefined()
    }
  )
})

describe('lead replacement in the recorded switches (spec 6.4, 6.5)', () => {
  const switches: (readonly [string, ReplayRun])[] = [
    ...runs('droid-parent-process-hooks').filter(([name]) => name.endsWith('/t1-new')),
    ...runs('droid-new-clear-hooks'),
    ...runs('droid-tree-resume-hooks'),
    ...runs('droid-slow-start-hooks'),
    ...runs('droid-two-command-hooks')
  ].map(([name, run], index) => [`${index} ${name}`, run] as const)

  it.each(switches)('%s: a parentless start of another id replaces the lead', (_name, run) => {
    const { driver, steps } = replay(run)
    const starts = steps.filter(
      (step) =>
        step.hook.payload.hook_event_name === 'SessionStart' &&
        step.hook.payload.calling_session_id === undefined
    )

    expect(starts.length).toBeGreaterThan(1)
    for (const start of starts) {
      expect(start.leadAfter, start.hook.label).toBe(start.hook.payload.session_id)
    }
    // The old session's caches go with it, and a repeat of the lead's own id changes nothing.
    for (const start of starts.filter((step) => step.leadBefore !== step.leadAfter)) {
      expect(start.event, start.hook.label).toBeNull()
    }
    expect(driver.row()?.agentPresence?.ended).toBeUndefined()
  })

  it.each(switches)('%s: only the current lead SessionEnd reaches the host', (_name, run) => {
    const { driver, steps } = replay(run)

    for (const step of steps.filter((s) => s.hook.payload.hook_event_name === 'SessionEnd')) {
      const names = step.hook.payload.session_id
      if (names === step.leadBefore) {
        expect(step.event?.hookEventName, step.hook.label).toBe('SessionEnd')
        expect(step.event?.agentPresence?.process).toEqual(run.identity)
        expect(step.event?.agentPresence?.ended).toBeUndefined()
      } else {
        expect(step.event, step.hook.label).toBeNull()
      }
    }
    // No SessionEnd of any reason ended the row on its own.
    expect(driver.row()?.agentPresence?.ended).toBeUndefined()
    expect(driver.row()?.providerSessionOnly).toBeUndefined()
  })

  it('/new: the clear SessionEnd arms an exit check, the new start disarms it, the late other is dropped', () => {
    const { steps } = replay(named('droid-parent-process-hooks', 'tui-0.244.0/t1-new'))

    expect(steps.map((step) => [step.hook.label, step.watching])).toEqual([
      ['SessionStart 389086d3 startup', false],
      ['UserPromptSubmit 389086d3-0000-4000-8000-000000000000 (replay adds)', false],
      ['SessionEnd 389086d3 clear', true],
      ['SessionStart 8050463b resume', false],
      ['SessionEnd 389086d3 other', false],
      ['SessionEnd 8050463b other', true]
    ])
  })
})

describe('a SessionStart hook slower than about 10 s (spec 6.4: 124 of 124)', () => {
  const slow = loadDroidProbeRuns('droid-slow-start-hooks', { promptForFirstLead: true })

  it('has 124 switches whose old SessionEnd other arrives before the new SessionStart', () => {
    let inverted = 0
    for (const run of slow) {
      const { steps } = replay(run)
      for (const end of invertedSessionEnds(run)) {
        const index = steps.findIndex((step) => step.hook === end)
        const next = steps[index + 1]
        inverted += 1
        expect(steps[index].event?.hookEventName, end.label).toBe('SessionEnd')
        expect(steps[index].watching, end.label).toBe(true)
        expect(next.watching, next.hook.label).toBe(false)
        expect(next.leadAfter, next.hook.label).toBe(next.hook.payload.session_id)
      }
    }

    expect(inverted).toBe(124)
  })
})

describe('Task subagents (spec 6.5)', () => {
  it('0.238.0: a child start is recorded, its work shows, its Stop removes it', () => {
    const run = named('droid-subagent-hooks', 'tui-0.238.0/p1-task')
    const { driver, steps } = replay(run)
    const child = run.id('S2')
    const lead = run.id('S1')

    expect(at(steps, 'SessionStart S2 startup').leadAfter).toBe(lead)
    expect(
      steps.filter((s) => s.hook.label.startsWith('SessionStart S2')).map((s) => s.event)
    ).toEqual([null, null])
    expect(at(steps, 'UserPromptSubmit S2').event?.payload.subagents?.map((c) => c.id)).toEqual([
      child
    ])
    expect(at(steps, 'Stop S2').event?.payload.subagents).toBeUndefined()
    expect(at(steps, 'SubagentStop S1').event).toBeNull()
    expect(driver.row()?.payload.state).toBe('done')
    expect(leadOf(driver)).toBe(lead)
  })

  it('0.244.0: a child start after its Stop and its SessionEnd change nothing', () => {
    const run = named('droid-subagent-hooks', 'tui-0.244.0/p2-task')
    const { driver, steps } = replay(run)

    expect(at(steps, 'SessionStart S2 resume').event).toBeNull()
    expect(at(steps, 'SessionEnd S2 other').event).toBeNull()
    expect(subagentIds(driver)).toEqual([])
    expect(leadOf(driver)).toBe(run.id('S1'))
    // Only the lead's own SessionEnd, at the exit, arms the exit marker.
    expect(at(steps, 'SessionEnd S1 other').event?.hookEventName).toBe('SessionEnd')
  })

  it('never lets a Task subagent become the lead', () => {
    for (const run of loadDroidProbeRuns('droid-subagent-hooks')) {
      const { steps } = replay(run)
      const leads = new Set(steps.map((step) => step.leadAfter))

      expect(leads, run.name).toEqual(new Set([run.id('S1')]))
    }
  })

  it('0.238.0 background child: outlives the lead Stop, and the lead speaks again within the lease', () => {
    const run = named('droid-subagent-hooks', 'tui-0.238.0/p3-bg')
    const { driver, steps } = replay(run)
    const childStop = at(steps, 'Stop S2')
    const leadAgain = at(steps, 'UserPromptSubmit S1', 1)

    // The row never reads done while the child works after the lead's Stop.
    expect(at(steps, 'Stop S1').event?.payload.state).toBe('working')
    expect(at(steps, 'PostToolUse S2').event?.payload.state).toBe('working')
    expect(childStop.event?.payload.state).toBe('working')
    // The next lead hook came 0.6 s after the child's Stop, well inside the lease.
    expect((leadAgain.hook.atMs ?? 0) - (childStop.hook.atMs ?? 0)).toBeLessThan(
      DROID_BACKGROUND_CHILD_LEASE_MS
    )
    expect(leadAgain.event?.payload.state).toBe('working')
    expect(at(steps, 'Stop S1', 1).event?.payload.state).toBe('done')
    expect(driver.row()?.payload.state).toBe('done')
  })
})
