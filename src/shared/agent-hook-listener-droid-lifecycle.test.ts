import { describe, expect, it } from 'vitest'
import {
  clearAllListenerCaches,
  clearPaneCacheState,
  movePaneCacheState,
  paneHasStateClaims
} from './agent-hook-listener/listener-state'
import {
  CHILD_ID,
  LEAD_ID,
  createDroidHookDriver,
  sessionEnd,
  sessionStart,
  userPrompt
} from './agent-hook-listener-droid-driver'
import { PANE_KEY } from './agent-hook-listener-test-harness'

describe('Droid provider state lifecycle', () => {
  it('moves session claims with the pane and clears them on teardown', () => {
    const { state, hook } = createDroidHookDriver()
    hook(sessionStart(LEAD_ID))
    expect(paneHasStateClaims(state, PANE_KEY)).toBe(true)
    const sessions = state.droidSessionsByPaneKey.get(PANE_KEY)

    movePaneCacheState(state, PANE_KEY, 'next-pane')
    expect(paneHasStateClaims(state, PANE_KEY)).toBe(false)
    expect(state.droidSessionsByPaneKey.get('next-pane')).toBe(sessions)
    clearPaneCacheState(state, 'next-pane')
    expect(paneHasStateClaims(state, 'next-pane')).toBe(false)

    hook(sessionStart(LEAD_ID))
    clearAllListenerCaches(state)
    expect(state.droidSessionsByPaneKey.size).toBe(0)
  })

  it('does not let an orphan SessionEnd choose the next provisional lead', () => {
    const driver = createDroidHookDriver()
    expect(driver.hook(sessionEnd('orphan'))).toBeNull()
    expect(driver.hook(userPrompt(LEAD_ID))?.providerSession?.id).toBe(LEAD_ID)
  })

  it('requires a previously captured owner before a SessionEnd can arm the watch', () => {
    const driver = createDroidHookDriver()
    driver.hook(sessionStart(LEAD_ID), null)
    driver.hook(userPrompt(LEAD_ID), null)

    expect(driver.hook(sessionEnd(LEAD_ID))).toBeNull()
    expect(driver.state.droidSessionsByPaneKey.get(PANE_KEY)?.exitMarker).toBeUndefined()
  })

  it('keeps a repeat start from changing child snapshots', () => {
    const driver = createDroidHookDriver()
    driver.hook(sessionStart(LEAD_ID))
    driver.hook(userPrompt(LEAD_ID))
    driver.hook(sessionStart(CHILD_ID, { calling_session_id: LEAD_ID }))
    driver.hook(userPrompt(CHILD_ID))
    const row = driver.row()
    const sessions = driver.state.droidSessionsByPaneKey.get(PANE_KEY)
    driver.hook(sessionStart(LEAD_ID))
    expect(driver.row()).toBe(row)
    expect(driver.state.droidSessionsByPaneKey.get(PANE_KEY)).toBe(sessions)
    expect(sessions?.roster.size).toBe(1)
  })
})
