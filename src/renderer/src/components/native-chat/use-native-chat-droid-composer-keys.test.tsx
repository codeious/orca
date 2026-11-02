// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat/input/native-chat-session-options'
import { useNativeChatDroidComposerKeys } from './use-native-chat-droid-composer-keys'

function choice(id: string, values: string[], currentValue = values[0]): SessionOptionDescriptor {
  return {
    id,
    label: id,
    kind: {
      type: 'select',
      choices: values.map((value) => ({ value, label: value })),
      currentValue
    },
    settable: true,
    valueSource: 'reported',
    transport: 'agent-session'
  }
}

const SPEC: SessionOptionDescriptor = {
  id: 'planMode',
  label: 'Spec',
  kind: { type: 'boolean', currentValue: false },
  settable: true,
  valueSource: 'reported',
  transport: 'agent-session'
}
const SNAPSHOT = [
  SPEC,
  choice('autonomyLevel', ['off', 'low', 'medium']),
  choice('effort', ['low', 'high']),
  choice('model', ['first', 'second'])
]

beforeEach(() => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh')
})
afterEach(() => vi.restoreAllMocks())

function setup(snapshot = SNAPSHOT, isWorking = false, agent = 'droid') {
  const setOption = vi.fn(async () => ({ snapshot }))
  const sendAfterReply = vi.fn()
  const hook = renderHook(
    (snapshot: SessionOptionDescriptor[]) =>
      useNativeChatDroidComposerKeys({
        agent,
        snapshot,
        surface: { setOption },
        isWorking,
        sendAfterReply
      }),
    { initialProps: snapshot }
  )
  return { hook, setOption, sendAfterReply }
}

describe('profile-claimed composer option keys', () => {
  it('uses offered option order and the existing absolute write path', () => {
    const { hook, setOption } = setup()
    hook.result.current?.shiftTab?.()
    hook.result.current?.ctrlL?.()
    hook.result.current?.tab?.()
    hook.result.current?.ctrlN?.()
    expect(setOption.mock.calls).toEqual([
      ['planMode', true],
      ['autonomyLevel', 'low'],
      ['effort', 'high'],
      ['model', 'second']
    ])
  })

  it('uses new reports, wraps choices, and starts an unknown value at the first choice', () => {
    const { hook, setOption } = setup()
    hook.rerender([choice('effort', ['low', 'high'], 'high')])
    hook.result.current?.tab?.()
    hook.rerender([choice('effort', ['low', 'high'], 'unlisted')])
    hook.result.current?.tab?.()
    expect(setOption.mock.calls).toEqual([
      ['effort', 'low'],
      ['effort', 'low']
    ])
  })

  it('does not claim unavailable, locked, or single-choice options', () => {
    const { hook, setOption } = setup([{ ...SPEC, settable: false }, choice('model', ['only'])])
    expect(hook.result.current).toEqual({ ctrlEnter: expect.any(Function) })
    expect(setOption).not.toHaveBeenCalled()
  })

  it('holds mode keys during a reply but still offers send-after-reply', () => {
    const { hook, setOption, sendAfterReply } = setup(SNAPSHOT, true)
    hook.result.current?.shiftTab?.()
    hook.result.current?.ctrlL?.()
    hook.result.current?.tab?.()
    hook.result.current?.ctrlN?.()
    expect(setOption).not.toHaveBeenCalled()
    hook.result.current?.ctrlEnter?.()
    expect(sendAfterReply).toHaveBeenCalledOnce()
  })

  it.each(['Windows NT 10.0', 'X11; Linux'])('reserves Orca keys on %s', (userAgent) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
    for (const isWorking of [false, true]) {
      const { hook, setOption } = setup(SNAPSHOT, isWorking)
      expect(hook.result.current?.ctrlL).toBeUndefined()
      expect(hook.result.current?.ctrlN).toBeUndefined()
      hook.result.current?.shiftTab?.()
      hook.result.current?.tab?.()
      expect(setOption.mock.calls).toEqual(
        isWorking
          ? []
          : [
              ['planMode', true],
              ['effort', 'high']
            ]
      )
    }
  })

  it('does not add actions to another agent', () => {
    const { hook } = setup(SNAPSHOT, false, 'codex')
    expect(hook.result.current).toBeUndefined()
  })
})
