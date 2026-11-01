import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPaneCacheState,
  seedLegacyAgentStatusForTests
} from './agent-hook-listener/listener-state'
import type { AgentHookEventPayload } from './agent-hook-listener/listener-event'
import {
  CHILD_ID,
  DROID_OTHER,
  DROID_OWNER,
  LEAD_ID,
  NEXT_LEAD_ID,
  createDroidHookDriver,
  sessionStart,
  userPrompt,
  type DroidHookDriver
} from './agent-hook-listener-droid-driver'
import { PANE_KEY } from './agent-hook-listener-test-harness'

let driver: DroidHookDriver

function endRow(options: { hostCleanup: boolean }): AgentHookEventPayload {
  const row = driver.row()!
  const ended: AgentHookEventPayload = {
    ...row,
    agentPresence: { agent: 'droid', process: DROID_OWNER, ended: true },
    ...(options.hostCleanup ? { providerSessionOnly: true, retainedForLiveness: true } : {})
  }
  if (options.hostCleanup) {
    clearPaneCacheState(driver.state, PANE_KEY)
  }
  seedLegacyAgentStatusForTests(driver.state, ended)
  return ended
}

beforeEach(() => {
  driver = createDroidHookDriver()
  driver.hook(sessionStart(LEAD_ID))
  driver.hook(userPrompt(LEAD_ID, 'ship it'))
  driver.hook(sessionStart(CHILD_ID, { calling_session_id: LEAD_ID }))
  driver.hook(userPrompt(CHILD_ID, 'child work'))
})

describe('a Droid hook after the row has ended', () => {
  it('from the owner process leaves the row ended, as the host leaves it after an exit', () => {
    const ended = endRow({ hostCleanup: true })

    driver.hook(sessionStart(LEAD_ID, { source: 'resume' }))
    driver.hook(userPrompt(LEAD_ID, 'revived?'))

    expect(driver.row()).toBe(ended)
  })

  it('from the owner process neither restates the row nor touches the roster it still holds', () => {
    const ended = endRow({ hostCleanup: false })
    const sessions = driver.state.droidSessionsByPaneKey.get(PANE_KEY)
    expect(sessions?.roster.size).toBe(1)

    expect(driver.hook(sessionStart(LEAD_ID, { source: 'resume' }))).toBeNull()
    driver.hook(userPrompt(LEAD_ID, 'revived?'))

    expect(driver.row()).toBe(ended)
    expect(driver.state.droidSessionsByPaneKey.get(PANE_KEY)).toBe(sessions)
    expect(sessions?.roster.size).toBe(1)
  })

  it('from a new process makes that process the fresh owner', () => {
    endRow({ hostCleanup: true })

    driver.hook(sessionStart(NEXT_LEAD_ID), DROID_OTHER)
    driver.hook(userPrompt(NEXT_LEAD_ID, 'new droid'), DROID_OTHER)

    expect(driver.row()?.agentPresence).toEqual({ agent: 'droid', process: DROID_OTHER })
    expect(driver.row()?.payload.prompt).toBe('new droid')
    expect(driver.row()?.providerSession?.id).toBe(NEXT_LEAD_ID)
  })

  it('from a new process drops the ended lead’s roster and starts a fresh lead', () => {
    endRow({ hostCleanup: false })

    driver.hook(sessionStart(NEXT_LEAD_ID), DROID_OTHER)
    driver.hook(userPrompt(NEXT_LEAD_ID, 'new droid'), DROID_OTHER)

    const sessions = driver.state.droidSessionsByPaneKey.get(PANE_KEY)
    expect(sessions?.leadId).toBe(NEXT_LEAD_ID)
    expect(sessions?.roster.size).toBe(0)
    expect(driver.row()?.agentPresence).toEqual({ agent: 'droid', process: DROID_OTHER })
    expect(driver.row()?.payload.subagents).toBeUndefined()
  })
})
