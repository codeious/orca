// @vitest-environment happy-dom

// The seam for rewind-by-Esc: three Esc presses on an empty composer, each gap within 175 ms. Nothing
// in the app passes `openRewind` yet, so this is the one place the limit is pinned.

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DROID_ESC_REWIND_GAP_MS } from '../../../../shared/droid-composer-keys'
import { useNativeChatDroidTurnKeys } from './use-native-chat-droid-turn-keys'

function setup(args: { hasContent?: boolean; agent?: 'droid' | 'claude'; inert?: boolean } = {}) {
  const calls = {
    stopTurn: vi.fn(),
    clearComposer: vi.fn(),
    openRewind: vi.fn()
  }
  const keys = { tab: vi.fn() }
  const hook = renderHook(() =>
    useNativeChatDroidTurnKeys({
      agent: args.agent ?? 'droid',
      keys,
      ...(args.inert ? { inert: true } : {}),
      stopTurn: calls.stopTurn,
      selectedText: () => '',
      hasContent: args.hasContent ?? false,
      clearComposer: calls.clearComposer,
      openRewind: calls.openRewind
    })
  )
  return { keys, calls, hook, escape: () => hook.result.current?.escape?.() }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Esc on an empty Droid composer', () => {
  it('names the captured limit: 175 ms opened rewind, 200 ms did not', () => {
    expect(DROID_ESC_REWIND_GAP_MS).toBe(175)
  })

  it('opens rewind on the third press when each gap is at most 175 ms', () => {
    const { calls, escape } = setup()
    escape()
    vi.advanceTimersByTime(175)
    escape()
    expect(calls.openRewind).not.toHaveBeenCalled()
    vi.advanceTimersByTime(175)
    escape()
    expect(calls.openRewind).toHaveBeenCalledOnce()
  })

  it('does not open rewind when a gap is 200 ms', () => {
    const slowFirst = setup()
    slowFirst.escape()
    vi.advanceTimersByTime(200)
    slowFirst.escape()
    vi.advanceTimersByTime(100)
    slowFirst.escape()
    expect(slowFirst.calls.openRewind).not.toHaveBeenCalled()

    const slowSecond = setup()
    slowSecond.escape()
    vi.advanceTimersByTime(100)
    slowSecond.escape()
    vi.advanceTimersByTime(200)
    slowSecond.escape()
    expect(slowSecond.calls.openRewind).not.toHaveBeenCalled()
  })

  it('counts from the late press: three quick presses after a slow one still open it', () => {
    const { calls, escape } = setup()
    escape()
    vi.advanceTimersByTime(500)
    escape()
    vi.advanceTimersByTime(50)
    escape()
    vi.advanceTimersByTime(50)
    escape()
    expect(calls.openRewind).toHaveBeenCalledOnce()
  })

  it('does not open rewind or stop anything on one or two presses', () => {
    const { calls, escape } = setup()
    escape()
    vi.advanceTimersByTime(100)
    escape()
    vi.advanceTimersByTime(1500)
    expect(calls.openRewind).not.toHaveBeenCalled()
    expect(calls.stopTurn).not.toHaveBeenCalled()
    expect(calls.clearComposer).not.toHaveBeenCalled()
  })

  it('starts over after it opens', () => {
    const { calls, escape } = setup()
    for (let press = 0; press < 3; press++) {
      escape()
      vi.advanceTimersByTime(100)
    }
    escape()
    vi.advanceTimersByTime(100)
    escape()
    expect(calls.openRewind).toHaveBeenCalledOnce()
  })

  it('does not count a press that cleared the draft as one of the three', () => {
    const calls = { clearComposer: vi.fn(), openRewind: vi.fn() }
    let hasContent = false
    const hook = renderHook(() =>
      useNativeChatDroidTurnKeys({
        agent: 'droid',
        keys: undefined,
        stopTurn: undefined,
        selectedText: () => '',
        hasContent,
        clearComposer: calls.clearComposer,
        openRewind: calls.openRewind
      })
    )
    const escape = (): void => hook.result.current?.escape?.()

    escape()
    vi.advanceTimersByTime(50)
    escape()
    vi.advanceTimersByTime(50)

    hasContent = true
    hook.rerender()
    escape()
    expect(calls.clearComposer).toHaveBeenCalledOnce()

    // Within the gap of the two empty presses, yet only the first of a new run.
    vi.advanceTimersByTime(50)
    hasContent = false
    hook.rerender()
    escape()
    expect(calls.openRewind).not.toHaveBeenCalled()
  })

  it('does nothing while a prompt card owns the input', () => {
    const { calls, escape } = setup({ inert: true })
    for (let press = 0; press < 3; press++) {
      escape()
      vi.advanceTimersByTime(100)
    }
    expect(calls.openRewind).not.toHaveBeenCalled()
    expect(calls.clearComposer).not.toHaveBeenCalled()
  })
})

describe('keys of every other agent', () => {
  it('passes the mode keys through and adds no Ctrl+C or Esc', () => {
    const { keys, hook } = setup({ agent: 'claude' })
    expect(hook.result.current).toBe(keys)
    expect(hook.result.current).not.toHaveProperty('escape')
    expect(hook.result.current).not.toHaveProperty('ctrlC')
  })

  it('adds the turn keys to the Droid mode keys without dropping them', () => {
    const { keys, hook } = setup()
    expect(hook.result.current?.tab).toBe(keys.tab)
    expect(hook.result.current?.ctrlC).toBeTypeOf('function')
    expect(hook.result.current?.escape).toBeTypeOf('function')
  })
})
