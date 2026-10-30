// @vitest-environment happy-dom

// Shift+Tab is Droid's Spec switch and Ctrl+L its autonomy cycle. Each acts only for a Droid chat that
// can act on it, and otherwise leaves the key alone so it keeps its ordinary job.

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DroidAutonomyLevel } from '../../../../shared/droid-autonomy-options'
import type {
  SessionOptionAutonomy,
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

function setup(args: {
  agent: string
  snapshot: SessionOptionDescriptor[]
  autonomy?: SessionOptionAutonomy
}) {
  const setOption = vi.fn(async () => ({ snapshot: args.snapshot }))
  const surface: SessionOptionsSurface = {
    ...(args.autonomy ? { autonomy: args.autonomy } : {}),
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

const FOUR: readonly DroidAutonomyLevel[] = ['off', 'low', 'medium', 'high']

function autonomy(
  level: DroidAutonomyLevel,
  levels: readonly DroidAutonomyLevel[] = FOUR,
  settable = true
): SessionOptionAutonomy {
  return { level, levels, settable }
}

describe('useNativeChatDroidComposerKeys: Ctrl+L', () => {
  it.each([
    ['off', 'low'],
    ['low', 'medium'],
    ['medium', 'high'],
    ['high', 'off']
  ] as const)('before the first message, moves %s to %s', (from, to) => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [MODEL_ROW],
      autonomy: autonomy(from)
    })

    hook.result.current?.ctrlL?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('autonomyLevel', to)
  })

  it('cycles only the levels Droid reports, wrapping Off to Low and back', () => {
    const lowOnly = setup({
      agent: 'droid',
      snapshot: [MODEL_ROW],
      autonomy: autonomy('low', ['off', 'low'])
    })
    lowOnly.hook.result.current?.ctrlL?.()
    expect(lowOnly.setOption).toHaveBeenCalledExactlyOnceWith('autonomyLevel', 'off')

    const offOnly = setup({
      agent: 'droid',
      snapshot: [MODEL_ROW],
      autonomy: autonomy('off', ['off', 'low'])
    })
    offOnly.hook.result.current?.ctrlL?.()
    expect(offOnly.setOption).toHaveBeenCalledExactlyOnceWith('autonomyLevel', 'low')
  })

  it('moves on from a level Droid no longer offers instead of sticking on it', () => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [MODEL_ROW],
      autonomy: autonomy('high', ['off', 'low'])
    })

    hook.result.current?.ctrlL?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('autonomyLevel', 'off')
  })

  it('follows the newest surface, so the next press moves on from the last', () => {
    const setOption = vi.fn(async () => ({ snapshot: [] }))
    const surfaceOf = (current: SessionOptionAutonomy): SessionOptionsSurface => ({
      autonomy: current,
      getSnapshot: () => [],
      setOption,
      invokeAction: async () => ({ snapshot: [] }),
      subscribe: () => () => {}
    })
    const hook = renderHook(
      (props: { surface: SessionOptionsSurface }) =>
        useNativeChatDroidComposerKeys({ agent: 'droid', snapshot: [], surface: props.surface }),
      { initialProps: { surface: surfaceOf(autonomy('off')) } }
    )
    hook.rerender({ surface: surfaceOf(autonomy('low')) })

    hook.result.current?.ctrlL?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('autonomyLevel', 'medium')
  })

  it('claims no key before an answer names a level', () => {
    const { hook } = setup({ agent: 'droid', snapshot: [MODEL_ROW] })

    expect(hook.result.current?.ctrlL).toBeUndefined()
  })

  it('claims no key while the level cannot be set', () => {
    const { hook } = setup({
      agent: 'droid',
      snapshot: [MODEL_ROW],
      autonomy: autonomy('low', FOUR, false)
    })

    expect(hook.result.current?.ctrlL).toBeUndefined()
  })

  it('claims no key when Droid offers nothing to move to', () => {
    const { hook } = setup({
      agent: 'droid',
      snapshot: [MODEL_ROW],
      autonomy: autonomy('low', ['low'])
    })

    expect(hook.result.current?.ctrlL).toBeUndefined()
  })

  it('is wired beside Shift+Tab and leaves it to the Spec switch', () => {
    const both = setup({
      agent: 'droid',
      snapshot: [MODEL_ROW, specRow()],
      autonomy: autonomy('low')
    })
    expect(both.hook.result.current?.ctrlL).toBeDefined()

    both.hook.result.current?.shiftTab?.()
    expect(both.setOption).toHaveBeenCalledExactlyOnceWith('planMode', true)

    const levelOnly = setup({ agent: 'droid', snapshot: [MODEL_ROW], autonomy: autonomy('low') })
    expect(levelOnly.hook.result.current?.shiftTab).toBeUndefined()
  })

  it.each(['claude', 'codex', 'pi', 'grok', 'opencode'])(
    '%s: has no Ctrl+L even when its surface names a level',
    (agent) => {
      const { hook, setOption } = setup({
        agent,
        snapshot: [MODEL_ROW],
        autonomy: autonomy('low')
      })

      expect(hook.result.current).toBeUndefined()
      expect(setOption).not.toHaveBeenCalled()
    }
  )
})
