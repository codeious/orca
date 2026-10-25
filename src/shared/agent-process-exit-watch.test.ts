import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_EXIT_WATCH_FIRST_PROBE_MS,
  AGENT_EXIT_WATCH_MAX_PROBE_MS,
  AGENT_EXIT_WATCH_WINDOW_MS,
  AgentProcessExitWatch
} from './agent-process-exit-watch'
import type { AgentProcessVerdict } from './agent-process-presence'

type Verdict = AgentProcessVerdict | null

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
})

afterEach(() => {
  vi.useRealTimers()
})

function watchOf(answers: Verdict | (() => Promise<Verdict>) = 'live') {
  const calls: number[] = []
  const probe = vi.fn(async () => {
    calls.push(Date.now())
    return typeof answers === 'function' ? answers() : answers
  })
  return { calls, probe, isCurrent: vi.fn(() => true) }
}

describe('agent process exit watch', () => {
  it('names the spec timings: 0.25 s doubling to 8 s over about 90 s', () => {
    expect(AGENT_EXIT_WATCH_FIRST_PROBE_MS).toBe(250)
    expect(AGENT_EXIT_WATCH_MAX_PROBE_MS).toBe(8_000)
    expect(AGENT_EXIT_WATCH_WINDOW_MS).toBe(90_000)
  })

  it('probes at 0.25 s, doubles up to 8 s, and gives up at the bound', async () => {
    const watch = new AgentProcessExitWatch()
    const host = watchOf('live')
    const startedAt = Date.now()
    watch.start('pane', host)

    await vi.advanceTimersByTimeAsync(120_000)

    const gaps = host.calls.map((at, index) => at - (host.calls[index - 1] ?? startedAt))
    expect(gaps.slice(0, 7)).toEqual([250, 500, 1_000, 2_000, 4_000, 8_000, 8_000])
    expect(Math.max(...gaps)).toBe(8_000)
    expect(host.calls.at(-1)! - startedAt).toBeLessThanOrEqual(90_000)
    expect(host.calls.at(-1)! - startedAt).toBeGreaterThan(80_000)
    const settled = host.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(host.calls).toHaveLength(settled)
  })

  it('stops once the probe confirms the exit', async () => {
    const watch = new AgentProcessExitWatch()
    const answers: Verdict[] = ['live', 'unverifiable', 'exited']
    const host = watchOf(async () => answers.shift() ?? 'live')
    watch.start('pane', host)

    await vi.advanceTimersByTimeAsync(120_000)

    expect(host.probe).toHaveBeenCalledTimes(3)
  })

  it('stops when there is nothing left to check', async () => {
    const watch = new AgentProcessExitWatch()
    const host = watchOf(null)
    watch.start('pane', host)

    await vi.advanceTimersByTimeAsync(120_000)

    expect(host.probe).toHaveBeenCalledOnce()
  })

  it('keeps probing through unanswered reads until the bound', async () => {
    const watch = new AgentProcessExitWatch()
    const host = watchOf('unverifiable')
    watch.start('pane', host)

    await vi.advanceTimersByTimeAsync(120_000)

    expect(host.probe.mock.calls.length).toBeGreaterThan(10)
  })

  it('stops before probing once the pane is no longer what it watched', async () => {
    const watch = new AgentProcessExitWatch()
    const host = watchOf('live')
    watch.start('pane', host)
    await vi.advanceTimersByTimeAsync(250)
    expect(host.probe).toHaveBeenCalledOnce()

    host.isCurrent.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(host.probe).toHaveBeenCalledOnce()
  })

  it('does not reschedule a probe that settles after the watch was stopped', async () => {
    const watch = new AgentProcessExitWatch()
    let settle: (verdict: Verdict) => void = () => {}
    const host = watchOf(() => new Promise<Verdict>((resolve) => (settle = resolve)))
    watch.start('pane', host)
    await vi.advanceTimersByTimeAsync(250)
    expect(host.probe).toHaveBeenCalledOnce()

    watch.stop('pane')
    settle('live')
    await vi.advanceTimersByTimeAsync(120_000)

    expect(host.probe).toHaveBeenCalledOnce()
  })

  it('restarts from the first delay when the same pane is watched again', async () => {
    const watch = new AgentProcessExitWatch()
    const host = watchOf('live')
    watch.start('pane', host)
    await vi.advanceTimersByTimeAsync(250 + 500 + 1_000)
    expect(host.probe).toHaveBeenCalledTimes(3)

    watch.start('pane', host)
    await vi.advanceTimersByTimeAsync(250)

    expect(host.probe).toHaveBeenCalledTimes(4)
  })

  it('watches panes independently and stops them one at a time or all together', async () => {
    const watch = new AgentProcessExitWatch()
    const first = watchOf('live')
    const second = watchOf('live')
    watch.start('first', first)
    watch.start('second', second)

    watch.stop('first')
    await vi.advanceTimersByTimeAsync(250)
    expect(first.probe).not.toHaveBeenCalled()
    expect(second.probe).toHaveBeenCalledOnce()

    watch.stopAll()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(second.probe).toHaveBeenCalledOnce()
  })
})
