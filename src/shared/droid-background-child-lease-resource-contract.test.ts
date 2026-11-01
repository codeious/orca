import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentLeaseExpiryTimers } from './agent-lease-expiry-timers'
import {
  CHILD_ID,
  LEAD_ID,
  createDroidHookDriver,
  sessionStart,
  stop,
  userPrompt,
  type DroidHookDriver
} from './agent-hook-listener-droid-driver'
import { DROID_BACKGROUND_CHILD_LEASE_MS } from './agent-hook-listener/providers/droid-session-status'
import { PANE_KEY } from './agent-hook-listener-test-harness'

let driver: DroidHookDriver

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
  driver = createDroidHookDriver()
  driver.hook(sessionStart(LEAD_ID))
  driver.hook(userPrompt(LEAD_ID, 'refactor the parser'))
  driver.hook(sessionStart(CHILD_ID, { calling_session_id: LEAD_ID }))
  driver.hook(userPrompt(CHILD_ID))
  driver.hook(stop(LEAD_ID))
  driver.hook(stop(CHILD_ID))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Droid background child lease timer', () => {
  it('shares the one wakeup with the Claude lease and publishes the settled row at the deadline', () => {
    const timers = new AgentLeaseExpiryTimers(driver.state)
    const publish = vi.fn()

    timers.arm(PANE_KEY, publish)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(DROID_BACKGROUND_CHILD_LEASE_MS)

    expect(publish).toHaveBeenCalledOnce()
    expect(publish.mock.lastCall?.[0]).toMatchObject({
      paneKey: PANE_KEY,
      hookEventName: undefined,
      payload: { state: 'done' }
    })
    timers.clearAll()
  })

  it('restates the stored row under its own envelope, as a row with no hook event', () => {
    const stored = driver.row()
    const timers = new AgentLeaseExpiryTimers(driver.state)
    const publish = vi.fn()

    timers.arm(PANE_KEY, publish)
    vi.advanceTimersByTime(DROID_BACKGROUND_CHILD_LEASE_MS)

    expect(publish.mock.lastCall?.[0]).toMatchObject({
      tabId: stored?.tabId,
      worktreeId: stored?.worktreeId,
      providerSession: stored?.providerSession,
      payload: { prompt: 'refactor the parser', agentType: 'droid' }
    })
    expect(publish.mock.lastCall?.[0].hasExplicitPrompt).toBeUndefined()
    timers.clearAll()
  })

  it('arms nothing once the lead speaks again, and publishes nothing for a cleared lease', () => {
    const timers = new AgentLeaseExpiryTimers(driver.state)
    const publish = vi.fn()
    timers.arm(PANE_KEY, publish)

    driver.hook(userPrompt(LEAD_ID, 'continue'))
    vi.advanceTimersByTime(DROID_BACKGROUND_CHILD_LEASE_MS)

    expect(publish).not.toHaveBeenCalled()
    timers.arm(PANE_KEY, publish)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the timer when its host stops', () => {
    const timers = new AgentLeaseExpiryTimers(driver.state)
    const publish = vi.fn()
    timers.arm(PANE_KEY, publish)
    expect(vi.getTimerCount()).toBe(1)

    timers.clearAll()

    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(DROID_BACKGROUND_CHILD_LEASE_MS)
    expect(publish).not.toHaveBeenCalled()
  })

  it('waits out the remainder when its timer fires before the wall clock reaches the deadline', () => {
    const timers = new AgentLeaseExpiryTimers(driver.state)
    const publish = vi.fn()
    timers.arm(PANE_KEY, publish)

    vi.setSystemTime(Date.now() - 4_000)
    vi.advanceTimersByTime(DROID_BACKGROUND_CHILD_LEASE_MS)
    expect(publish).not.toHaveBeenCalled()

    vi.advanceTimersByTime(4_000)
    expect(publish).toHaveBeenCalledOnce()
    timers.clearAll()
  })
})
