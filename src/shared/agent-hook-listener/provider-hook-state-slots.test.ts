import { describe, expect, it } from 'vitest'
import {
  clearAllListenerCaches,
  clearPaneCacheState,
  createHookListenerState,
  movePaneCacheState,
  paneHasStateClaims
} from './listener-state'

describe('provider hook state slots', () => {
  it('moves and clears registered claims without disturbing other panes or map aliases', () => {
    const state = createHookListenerState()
    const owners = state.claudeSessionOwnerByPaneKey
    const tasks = state.claudeLaunchedBackgroundTasksByPaneKey
    const task = new Map()
    owners.set('source', 'session')
    tasks.set('source', task)
    owners.set('source-other', 'unrelated')
    expect(paneHasStateClaims(state, 'source')).toBe(true)

    movePaneCacheState(state, 'source', 'target')
    expect(paneHasStateClaims(state, 'source')).toBe(false)
    expect(paneHasStateClaims(state, 'target')).toBe(true)
    expect(owners.get('target')).toBe('session')
    expect(tasks.get('target')).toBe(task)
    movePaneCacheState(state, 'target', 'target')
    expect(tasks.get('target')).toBe(task)

    clearPaneCacheState(state, 'target')
    expect(paneHasStateClaims(state, 'target')).toBe(false)
    expect(tasks.size).toBe(0)
    expect(owners.get('source-other')).toBe('unrelated')
    clearAllListenerCaches(state)
    expect(owners.size).toBe(0)
    expect(state.claudeSessionOwnerByPaneKey).toBe(owners)
  })

  it('includes composite keys and newly registered maps in pane lifecycle cleanup', () => {
    const state = createHookListenerState()
    const cache = state.providerState.createMap<string>()
    cache.set('source\0suffix', 'cached')
    cache.set('source-other', 'unrelated')
    expect(paneHasStateClaims(state, 'source')).toBe(false)

    movePaneCacheState(state, 'source', 'target')
    expect(cache.get('target\0suffix')).toBe('cached')
    expect(cache.has('source\0suffix')).toBe(false)
    clearPaneCacheState(state, 'target')
    expect([...cache]).toEqual([['source-other', 'unrelated']])
    clearAllListenerCaches(state)
    expect(cache.size).toBe(0)
  })
})
