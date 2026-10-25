import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPaneCacheState,
  createHookListenerState,
  seedLegacyAgentStatusForTests
} from './agent-hook-listener/listener-state'
import {
  CHILD_ID,
  DROID_OTHER,
  DROID_OWNER,
  LEAD_ID,
  NEXT_LEAD_ID,
  createDroidHookDriver,
  sessionEnd,
  sessionStart,
  userPrompt,
  type DroidHookDriver
} from './agent-hook-listener-droid-driver'
import { PANE_KEY } from './agent-hook-listener-test-harness'

let driver: DroidHookDriver

beforeEach(() => {
  driver = createDroidHookDriver()
})

describe('Droid process identity and SessionEnd', () => {
  it('records the sending process as the row owner', () => {
    driver.hook(sessionStart(LEAD_ID))
    const event = driver.hook(userPrompt(LEAD_ID))

    expect(event?.agentPresence).toEqual({
      agent: 'droid',
      process: DROID_OWNER
    })
    expect(driver.row()?.agentPresence?.process).toEqual(DROID_OWNER)
  })

  it.each(['other', 'clear', 'prompt_input_exit', 'logout'])(
    'never reads a lead SessionEnd (reason %s) as an exit by itself',
    (reason) => {
      driver.hook(sessionStart(LEAD_ID))
      driver.hook(userPrompt(LEAD_ID))

      const event = driver.hook(sessionEnd(LEAD_ID, reason))

      expect(event?.hookEventName).toBe('SessionEnd')
      expect(event?.agentPresence?.ended).toBeUndefined()
      expect(event?.agentPresence?.process).toEqual(DROID_OWNER)
      expect(event?.payload.state).toBe('working')
      expect(driver.row()?.agentPresence?.ended).toBeUndefined()
      // The row is what the host retains for resume if the exit is confirmed.
      expect(driver.row()?.providerSession?.id).toBe(LEAD_ID)
    }
  )

  it('changes nothing for a SessionEnd without a captured process identity', () => {
    driver.hook(sessionStart(LEAD_ID), null)
    driver.hook(userPrompt(LEAD_ID), null)

    expect(driver.hook(sessionEnd(LEAD_ID), null)).toBeNull()
  })

  it('drops a SessionEnd for a session that is not the lead', () => {
    driver.hook(sessionStart(LEAD_ID))
    driver.hook(userPrompt(LEAD_ID))
    driver.hook(sessionStart(CHILD_ID, { calling_session_id: LEAD_ID }))

    expect(driver.hook(sessionEnd(CHILD_ID))).toBeNull()
    expect(driver.hook(sessionEnd('never-seen-session'))).toBeNull()
  })
})

describe('Droid lead session', () => {
  it('treats a repeat start of the lead from the owner process as a full no-op', () => {
    driver.hook(sessionStart(LEAD_ID))
    driver.hook(userPrompt(LEAD_ID, 'ship it'))

    expect(driver.hook(sessionStart(LEAD_ID, { source: 'resume' }))).toBeNull()

    expect(driver.state.lastPromptByPaneKey.get(PANE_KEY)).toBe('ship it')
  })

  it('replaces the lead on a start with no parent that names a different session', () => {
    driver.hook(sessionStart(LEAD_ID))
    driver.hook(userPrompt(LEAD_ID, 'ship it'))

    expect(driver.hook(sessionStart(NEXT_LEAD_ID, { source: 'resume' }))).toBeNull()

    expect(driver.state.lastPromptByPaneKey.has(PANE_KEY)).toBe(false)
    // The old session is now unseen and has no parent, so it is not adopted back.
    expect(driver.hook(userPrompt(LEAD_ID, 'late'))).toBeNull()
    expect(driver.hook(userPrompt(NEXT_LEAD_ID, 'next'))?.payload.prompt).toBe('next')
  })

  it('replaces the lead on a repeat start when the row has no captured identity', () => {
    driver.hook(sessionStart(LEAD_ID), null)
    driver.hook(userPrompt(LEAD_ID, 'ship it'), null)

    driver.hook(sessionStart(LEAD_ID), null)

    expect(driver.state.lastPromptByPaneKey.has(PANE_KEY)).toBe(false)
  })

  it('never lets a hook from another process choose or replace the lead', () => {
    driver.hook(sessionStart(LEAD_ID))
    driver.hook(userPrompt(LEAD_ID, 'ship it'))

    const foreign = driver.hook(sessionStart(NEXT_LEAD_ID), DROID_OTHER)

    // The row is restated under the sender so the host can probe the owner; nothing else changes.
    expect(foreign?.agentPresence?.process).toEqual(DROID_OTHER)
    expect(foreign?.payload.state).toBe('working')
    expect(driver.state.lastPromptByPaneKey.get(PANE_KEY)).toBe('ship it')
    expect(driver.row()?.agentPresence?.process).toEqual(DROID_OWNER)
    // Another process's session id never becomes the pane's resume identity.
    expect(foreign?.providerSession?.id).toBe(LEAD_ID)
    expect(driver.hook(userPrompt(LEAD_ID, 'still lead'))?.payload.prompt).toBe('still lead')
  })

  it('seeds the lead from the restored row and adopts no unseen session without a parent', () => {
    driver.hook(sessionStart(LEAD_ID))
    driver.hook(userPrompt(LEAD_ID))
    const restored = driver.row()!
    driver.state = createHookListenerState()
    seedLegacyAgentStatusForTests(driver.state, {
      ...restored,
      restoredUnconfirmed: true
    })

    expect(driver.hook(userPrompt(NEXT_LEAD_ID, 'stranger'))).toBeNull()
    expect(driver.hook(userPrompt(LEAD_ID, 'resumed'))?.payload.prompt).toBe('resumed')
  })

  it('takes the first session seen as a provisional lead and repoints to the chain root', () => {
    // The first hook after a restart with no resume identity came from a child.
    driver.hook(userPrompt(CHILD_ID, 'worker prompt'))
    driver.hook(sessionStart(CHILD_ID, { calling_session_id: LEAD_ID }))

    expect(driver.hook(userPrompt(LEAD_ID, 'the real lead'))?.payload.prompt).toBe('the real lead')
  })

  it('lets a new process choose a fresh lead once the host has cleared the exited owner', () => {
    driver.hook(sessionStart(LEAD_ID))
    driver.hook(userPrompt(LEAD_ID))
    clearPaneCacheState(driver.state, PANE_KEY)

    expect(driver.hook(userPrompt(NEXT_LEAD_ID, 'new droid'), DROID_OTHER)?.payload.prompt).toBe(
      'new droid'
    )
    expect(driver.row()?.agentPresence?.process).toEqual(DROID_OTHER)
  })
})
