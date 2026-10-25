import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHILD_ID,
  LEAD_ID,
  NEXT_LEAD_ID,
  SECOND_CHILD_ID,
  createDroidHookDriver,
  notification,
  postTool,
  preTool,
  sessionEnd,
  sessionStart,
  stop,
  userPrompt,
  type DroidHookDriver
} from './agent-hook-listener-droid-driver'
import { DROID_BACKGROUND_CHILD_LEASE_MS } from './agent-hook-listener/providers/droid-session-status'
import { isAgentStatusHeldOpenByChildWork } from './agent-lead-status-fold'

let driver: DroidHookDriver

const startChild = (id = CHILD_ID, parent = LEAD_ID) =>
  driver.hook(sessionStart(id, { calling_session_id: parent }))
const subagents = () => driver.row()?.payload.subagents ?? []

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
  driver = createDroidHookDriver()
  driver.hook(sessionStart(LEAD_ID))
  driver.hook(userPrompt(LEAD_ID, 'refactor the parser'))
})

afterEach(() => {
  vi.useRealTimers()
})

// Event order below is the recorded plain-Task branch (droid 0.244, research p2-task), ids replaced.
describe('Droid plain Task child (recorded order)', () => {
  it('shows nothing for a child start, then a working snapshot on its first activity', () => {
    driver.hook(preTool(LEAD_ID, 'Task'))

    expect(startChild()).toBeNull()
    expect(subagents()).toEqual([])

    const event = driver.hook(userPrompt(CHILD_ID, 'child task text'))

    expect(event?.payload.subagents).toEqual([
      {
        id: CHILD_ID,
        agentType: 'droid',
        description: `Droid agent ${CHILD_ID.slice(0, 8)}`,
        state: 'working',
        startedAt: 1_000_000
      }
    ])
    expect(event?.payload.state).toBe('working')
  })

  it('keeps the lead prompt, tool, and resume identity while a child talks', () => {
    driver.hook(preTool(LEAD_ID, 'Task'))
    startChild()

    const event = driver.hook(userPrompt(CHILD_ID, 'child task text'))
    driver.hook(preTool(CHILD_ID, 'Grep'))

    expect(event?.payload.prompt).toBe('refactor the parser')
    expect(event?.providerSession).toEqual({ key: 'session_id', id: LEAD_ID })
    expect(event?.hasExplicitPrompt).toBeUndefined()
    expect(driver.row()?.providerSession?.id).toBe(LEAD_ID)
    expect(driver.row()?.payload.toolName).toBe('Task')
  })

  it('drops the second start and the SessionEnd of a finished child, and SubagentStop', () => {
    driver.hook(preTool(LEAD_ID, 'Task'))
    startChild()
    driver.hook(userPrompt(CHILD_ID, 'child task text'))
    driver.hook(stop(CHILD_ID))

    expect(startChild()).toBeNull()
    expect(driver.hook(sessionEnd(CHILD_ID))).toBeNull()
    expect(driver.hook({ hook_event_name: 'SubagentStop', session_id: LEAD_ID })).toBeNull()
    expect(subagents()).toEqual([])
    expect(driver.hook(postTool(LEAD_ID, 'Task'))?.payload.state).toBe('working')
    expect(driver.hook(stop(LEAD_ID))?.payload.state).toBe('done')
  })

  it('never reads a child Stop as the row finishing', () => {
    driver.hook(preTool(LEAD_ID, 'Task'))
    startChild()
    driver.hook(userPrompt(CHILD_ID))

    const event = driver.hook(stop(CHILD_ID))

    expect(event?.payload.state).toBe('working')
    expect(event?.payload.subagents).toBeUndefined()
  })

  it('treats the child SessionEnd as its end', () => {
    startChild()
    driver.hook(userPrompt(CHILD_ID))

    const event = driver.hook(sessionEnd(CHILD_ID))

    expect(event?.payload.subagents).toBeUndefined()
    expect(event?.agentPresence?.ended).toBeUndefined()
  })
})

describe('Droid child status', () => {
  it('lets a waiting child outrank a working lead, and a lead permission wait keep its own state', () => {
    startChild()
    driver.hook(userPrompt(CHILD_ID))

    const waiting = driver.hook(notification(CHILD_ID, 'permission_prompt'))

    expect(waiting?.payload.state).toBe('waiting')
    expect(waiting?.payload.subagents?.[0]?.state).toBe('waiting')
    expect(driver.hook(postTool(CHILD_ID))?.payload.state).toBe('working')
  })

  it('never reads a child PreToolUse for an AskUser tool as waiting', () => {
    startChild()

    expect(driver.hook(preTool(CHILD_ID, 'AskUser'))?.payload.state).toBe('working')
  })

  it('keeps the row working while a child works after the lead stops, and holds it open', () => {
    startChild()
    driver.hook(userPrompt(CHILD_ID))

    const done = driver.hook(stop(LEAD_ID))

    expect(done?.payload.state).toBe('working')
    expect(done?.payload.mainAgent?.state).toBe('done')
    expect(
      isAgentStatusHeldOpenByChildWork({
        ...done!.payload,
        mainAgent: done!.payload.mainAgent
      })
    ).toBe(true)
  })

  it('hides an interrupted child on its idle prompt without finishing it', () => {
    startChild()
    driver.hook(userPrompt(CHILD_ID))
    driver.hook(stop(LEAD_ID))

    const idle = driver.hook(notification(CHILD_ID, 'idle_prompt'))

    expect(idle?.payload.subagents).toBeUndefined()
    expect(idle?.payload.state).toBe('done')
    // Continue: the same child works again and is shown again.
    expect(driver.hook(preTool(CHILD_ID))?.payload.subagents?.[0]?.id).toBe(CHILD_ID)
  })
})

describe('Droid lead Stop and idle prompt (synthetic: Mission and interrupt, markdown-only research)', () => {
  it('keeps children of the open turn across a lead Stop', () => {
    startChild()
    driver.hook(userPrompt(CHILD_ID))

    driver.hook(stop(LEAD_ID))

    expect(subagents().map((s) => s.id)).toEqual([CHILD_ID])
  })

  it('drops the children of the open turn on a lead idle prompt', () => {
    startChild()
    driver.hook(userPrompt(CHILD_ID))

    const idle = driver.hook(notification(LEAD_ID, 'idle_prompt'))

    expect(idle?.payload.state).toBe('done')
    expect(idle?.payload.subagents).toBeUndefined()
    expect(isAgentStatusHeldOpenByChildWork(idle!.payload)).toBe(false)
  })

  it('lets a background child that outlived a Stop survive a later idle prompt', () => {
    startChild()
    driver.hook(userPrompt(CHILD_ID))
    driver.hook(stop(LEAD_ID))

    const idle = driver.hook(notification(LEAD_ID, 'idle_prompt'))

    expect(idle?.payload.state).toBe('working')
    expect(idle?.payload.subagents?.map((s) => s.id)).toEqual([CHILD_ID])
  })

  it('does not drop a child started in the next turn when an older one is dropped', () => {
    startChild()
    driver.hook(userPrompt(CHILD_ID))
    driver.hook(notification(LEAD_ID, 'idle_prompt'))
    driver.hook(userPrompt(LEAD_ID, 'second turn'))
    startChild(SECOND_CHILD_ID)

    const event = driver.hook(userPrompt(SECOND_CHILD_ID))

    expect(event?.payload.subagents?.map((s) => s.id)).toEqual([SECOND_CHILD_ID])
  })

  it('drops all children when the lead session is replaced, and settles a row they held open', () => {
    startChild()
    driver.hook(userPrompt(CHILD_ID))
    driver.hook(stop(LEAD_ID))

    const settled = driver.hook(sessionStart(NEXT_LEAD_ID, { source: 'resume' }))

    expect(settled?.payload.state).toBe('done')
    expect(settled?.payload.subagents).toBeUndefined()
    expect(settled?.payload.mainAgent).toBeUndefined()
    expect(driver.hook(preTool(CHILD_ID))).toBeNull()
  })
})

describe('Droid background child lease (synthetic: named constant, fake timers)', () => {
  function backgroundChildStops() {
    startChild()
    driver.hook(userPrompt(CHILD_ID))
    driver.hook(stop(LEAD_ID))
    return driver.hook(stop(CHILD_ID))
  }

  it('holds the row working after the last background child stops while the lead is stopped', () => {
    const event = backgroundChildStops()

    expect(event?.payload.state).toBe('working')
    expect(event?.payload.subagents).toBeUndefined()
    expect(event?.payload.mainAgent?.state).toBe('done')
  })

  it('releases the lease when the lead speaks again', () => {
    backgroundChildStops()

    vi.advanceTimersByTime(DROID_BACKGROUND_CHILD_LEASE_MS - 1)
    const woke = driver.hook(userPrompt(LEAD_ID, 'continue'))

    expect(woke?.payload.state).toBe('working')
    expect(driver.hook(stop(LEAD_ID))?.payload.state).toBe('done')
  })

  it('does not lease for a foreground child that finishes while the lead works', () => {
    startChild()
    driver.hook(userPrompt(CHILD_ID))

    const event = driver.hook(stop(CHILD_ID))

    expect(event?.payload.state).toBe('working')
    expect(event?.payload.mainAgent).toBeUndefined()
  })
})
