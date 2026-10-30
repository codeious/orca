// @vitest-environment happy-dom

// Shift+Tab is Droid's Spec switch. It acts only for a Droid chat that offers a settable Spec row,
// and otherwise leaves the key alone so it can still move focus.

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat-session-options'
import { useNativeChatDroidComposerKeys } from './use-native-chat-droid-composer-keys'

function specRow(overrides: Partial<SessionOptionDescriptor> = {}): SessionOptionDescriptor {
  return {
    id: 'planMode',
    label: 'Spec',
    category: 'mode',
    kind: { type: 'boolean', currentValue: false },
    valueSource: 'default',
    transport: 'agent-session',
    settable: true,
    ...overrides
  }
}

const MODEL_ROW: SessionOptionDescriptor = {
  id: 'model',
  label: 'Model',
  category: 'model',
  kind: { type: 'select', choices: [{ value: 'a', label: 'A' }], currentValue: 'a' },
  valueSource: 'default',
  transport: 'agent-session',
  settable: true
}

function setup(args: { agent: string; snapshot: SessionOptionDescriptor[] }) {
  const setOption = vi.fn(async () => ({ snapshot: args.snapshot }))
  const surface: SessionOptionsSurface = {
    getSnapshot: () => args.snapshot,
    setOption,
    invokeAction: async () => ({ snapshot: args.snapshot }),
    subscribe: () => () => {}
  }
  const hook = renderHook(
    (props: { snapshot: SessionOptionDescriptor[] }) =>
      useNativeChatDroidComposerKeys({
        agent: args.agent,
        snapshot: props.snapshot,
        surface
      }),
    { initialProps: { snapshot: args.snapshot } }
  )
  return { hook, setOption }
}

describe('useNativeChatDroidComposerKeys', () => {
  it('turns Spec on from off', () => {
    const { hook, setOption } = setup({ agent: 'droid', snapshot: [MODEL_ROW, specRow()] })

    hook.result.current?.shiftTab?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('planMode', true)
  })

  it('turns Spec off from on', () => {
    const on = specRow({ kind: { type: 'boolean', currentValue: true }, valueSource: 'dispatched' })
    const { hook, setOption } = setup({ agent: 'droid', snapshot: [MODEL_ROW, on] })

    hook.result.current?.shiftTab?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('planMode', false)
  })

  it('follows the newest snapshot, so the next press undoes the last', () => {
    const { hook, setOption } = setup({ agent: 'droid', snapshot: [specRow()] })
    hook.rerender({
      snapshot: [
        specRow({ kind: { type: 'boolean', currentValue: true }, valueSource: 'dispatched' })
      ]
    })

    hook.result.current?.shiftTab?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('planMode', false)
  })

  it('claims no key before the chat offers a Spec row, so Shift+Tab still moves focus', () => {
    const { hook } = setup({ agent: 'droid', snapshot: [MODEL_ROW] })

    expect(hook.result.current?.shiftTab).toBeUndefined()
  })

  it('claims no key while the Spec row cannot be set', () => {
    const { hook } = setup({
      agent: 'droid',
      snapshot: [specRow({ settable: false, disabledReason: 'available-after-session-start' })]
    })

    expect(hook.result.current?.shiftTab).toBeUndefined()
  })

  it('claims no key when the chat has no options surface to send the switch through', () => {
    const hook = renderHook(() =>
      useNativeChatDroidComposerKeys({ agent: 'droid', snapshot: [specRow()], surface: null })
    )

    expect(hook.result.current).toBeUndefined()
  })

  it.each(['claude', 'codex', 'pi', 'grok', 'opencode'])(
    '%s: has no Droid keys even when its session offers a Spec-like row',
    (agent) => {
      const { hook, setOption } = setup({ agent, snapshot: [specRow()] })

      expect(hook.result.current).toBeUndefined()
      expect(setOption).not.toHaveBeenCalled()
    }
  )
})
