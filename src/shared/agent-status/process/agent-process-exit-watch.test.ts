import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentProcessExitWatch } from './agent-process-exit-watch'
import type { AgentProcessVerdict } from './agent-process-presence'

type Verdict = AgentProcessVerdict | null

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
})

afterEach(() => {
  vi.useRealTimers()
})

function watchOf(answers: Verdict | (() => Promise<Verdict>) = 'live') {
  const probe = vi.fn(async () => (typeof answers === 'function' ? answers() : answers))
  return { probe, isCurrent: vi.fn(() => true) }
}

describe('agent process exit watch', () => {
  it('keeps probing through unanswered reads and stops once the probe confirms the exit', async () => {
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

  it('keeps a restarted watch when the earlier probe settles late', async () => {
    const watch = new AgentProcessExitWatch()
    let settle: (verdict: Verdict) => void = () => {}
    const stale = watchOf(() => new Promise<Verdict>((resolve) => (settle = resolve)))
    const fresh = watchOf('live')
    watch.start('pane', stale)
    await vi.advanceTimersByTimeAsync(250)

    watch.start('pane', fresh)
    settle('live')
    await vi.advanceTimersByTimeAsync(250)

    expect(stale.probe).toHaveBeenCalledOnce()
    expect(fresh.probe).toHaveBeenCalledOnce()
  })
})
