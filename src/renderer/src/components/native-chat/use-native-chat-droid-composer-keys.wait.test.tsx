// @vitest-environment happy-dom

// Ctrl+Enter is Droid's send that waits for the running reply: claimed for Droid alone, and only
// where the chat has a send to make. Unlike the four mode keys it still acts while a turn runs.

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentType } from '../../../../shared/agent-status-types'
import { useNativeChatDroidComposerKeys } from './use-native-chat-droid-composer-keys'

const SURFACE = {
  setOption: vi.fn(async () => ({ snapshot: [] })),
  autonomy: undefined,
  refusedModelIds: undefined
}

function keysFor(args: {
  agent: AgentType | undefined
  isWorking?: boolean
  withSurface?: boolean
  sendAfterReply?: () => void
}) {
  const { result } = renderHook(() =>
    useNativeChatDroidComposerKeys({
      agent: args.agent,
      snapshot: [],
      surface: args.withSurface === false ? null : SURFACE,
      isWorking: args.isWorking ?? false,
      ...(args.sendAfterReply ? { sendAfterReply: args.sendAfterReply } : {})
    })
  )
  return result.current
}

describe('Droid Ctrl+Enter', () => {
  it.each([false, true])('runs the wait send when isWorking is %s', (isWorking) => {
    const sendAfterReply = vi.fn()
    const keys = keysFor({ agent: 'droid', isWorking, sendAfterReply })
    keys?.ctrlEnter?.()
    expect(sendAfterReply).toHaveBeenCalledOnce()
  })

  it('stays claimed beside the four mode keys, which are held mid-turn', () => {
    const keys = keysFor({ agent: 'droid', isWorking: true, sendAfterReply: vi.fn() })
    expect(Object.keys(keys ?? {}).toSorted()).toEqual(
      ['ctrlEnter', 'ctrlL', 'ctrlN', 'shiftTab', 'tab'].toSorted()
    )
  })

  it('needs no options surface to send', () => {
    const sendAfterReply = vi.fn()
    const keys = keysFor({ agent: 'droid', withSurface: false, sendAfterReply })
    expect(Object.keys(keys ?? {})).toEqual(['ctrlEnter'])
    keys?.ctrlEnter?.()
    expect(sendAfterReply).toHaveBeenCalledOnce()
  })

  it('is not claimed without a send to make, as in a terminal pane', () => {
    expect(keysFor({ agent: 'droid', isWorking: true })?.ctrlEnter).toBeUndefined()
    expect(keysFor({ agent: 'droid' })?.ctrlEnter).toBeUndefined()
  })

  it.each(['claude', 'codex', 'pi', 'grok', 'opencode', 'omp', undefined] as const)(
    'is not claimed for %s',
    (agent) => {
      for (const isWorking of [false, true]) {
        expect(keysFor({ agent, isWorking, sendAfterReply: vi.fn() })?.ctrlEnter).toBeUndefined()
      }
    }
  )
})
