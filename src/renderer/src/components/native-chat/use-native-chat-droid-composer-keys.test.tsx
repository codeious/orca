// @vitest-environment happy-dom

// Shift+Tab is Droid's Spec switch, Ctrl+L its autonomy cycle, Tab its reasoning-effort cycle and
// Ctrl+N its model cycle. Each acts only for a Droid chat that can act on it, and otherwise leaves
// the key alone so it keeps its ordinary job. While a turn runs all four are held, not handed back.

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

type KeysProps = { snapshot: SessionOptionDescriptor[]; isWorking?: boolean | undefined }

function setup(args: {
  agent: string
  snapshot: SessionOptionDescriptor[]
  autonomy?: SessionOptionAutonomy
  refusedModelIds?: readonly string[]
  isWorking?: boolean
}) {
  const setOption = vi.fn(async () => ({ snapshot: args.snapshot }))
  const surface: SessionOptionsSurface = {
    ...(args.autonomy ? { autonomy: args.autonomy } : {}),
    ...(args.refusedModelIds ? { refusedModelIds: args.refusedModelIds } : {}),
    getSnapshot: () => args.snapshot,
    setOption,
    invokeAction: async () => ({ snapshot: args.snapshot }),
    subscribe: () => () => {}
  }
  const initialProps: KeysProps = { snapshot: args.snapshot, isWorking: args.isWorking }
  const hook = renderHook(
    (props: KeysProps) =>
      useNativeChatDroidComposerKeys({
        agent: args.agent,
        snapshot: props.snapshot,
        surface,
        isWorking: props.isWorking
      }),
    { initialProps }
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

function selectRow(
  id: 'model' | 'effort',
  values: readonly string[],
  currentValue: string | undefined,
  overrides: Partial<SessionOptionDescriptor> = {}
): SessionOptionDescriptor {
  return {
    id,
    label: id === 'model' ? 'Model' : 'Reasoning effort',
    category: id === 'model' ? 'model' : 'thought_level',
    kind: {
      type: 'select',
      ...(currentValue === undefined ? {} : { currentValue }),
      choices: values.map((value) => ({ value, label: value.toUpperCase() }))
    },
    valueSource: 'default',
    transport: 'agent-session',
    settable: true,
    ...overrides
  }
}

const MODELS = ['haiku', 'sonnet', 'opus'] as const
const EFFORTS = ['off', 'low', 'medium', 'high'] as const

describe('useNativeChatDroidComposerKeys: Tab', () => {
  it.each([
    ['off', 'low'],
    ['low', 'medium'],
    ['medium', 'high'],
    ['high', 'off']
  ] as const)("moves the model's effort %s to %s, wrapping at the end", (from, to) => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [selectRow('model', MODELS, 'haiku'), selectRow('effort', EFFORTS, from)]
    })

    hook.result.current?.tab?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('effort', to)
  })

  it('walks the order of the effort row itself, not a fixed order', () => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [selectRow('effort', ['max', 'min', 'mid'], 'max')]
    })

    hook.result.current?.tab?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('effort', 'min')
  })

  it('starts at the first choice when no effort is named yet or the named one is not offered', () => {
    const unnamed = setup({ agent: 'droid', snapshot: [selectRow('effort', EFFORTS, undefined)] })
    unnamed.hook.result.current?.tab?.()
    expect(unnamed.setOption).toHaveBeenCalledExactlyOnceWith('effort', 'off')

    const stranger = setup({ agent: 'droid', snapshot: [selectRow('effort', EFFORTS, 'xhigh')] })
    stranger.hook.result.current?.tab?.()
    expect(stranger.setOption).toHaveBeenCalledExactlyOnceWith('effort', 'off')
  })

  it('follows the newest snapshot, so the next press moves on from the last', () => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [selectRow('effort', EFFORTS, 'off')]
    })
    hook.rerender({ snapshot: [selectRow('effort', EFFORTS, 'medium')] })

    hook.result.current?.tab?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('effort', 'high')
  })

  it('sets the effort alone, leaving the model, Spec and autonomy where they are', () => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [
        selectRow('model', MODELS, 'sonnet'),
        selectRow('effort', EFFORTS, 'low'),
        specRow()
      ],
      autonomy: autonomy('low')
    })

    hook.result.current?.tab?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('effort', 'medium')
  })

  it('claims no key for a model that offers no effort, so Tab keeps its ordinary job', () => {
    const { hook } = setup({ agent: 'droid', snapshot: [selectRow('model', MODELS, 'haiku')] })

    expect(hook.result.current?.tab).toBeUndefined()
  })

  it('claims no key while the effort cannot be set', () => {
    const { hook } = setup({
      agent: 'droid',
      snapshot: [
        selectRow('effort', EFFORTS, 'low', {
          settable: false,
          disabledReason: 'available-after-session-start'
        })
      ]
    })

    expect(hook.result.current?.tab).toBeUndefined()
  })

  it('claims no key when the effort offers nothing to move to', () => {
    const { hook } = setup({ agent: 'droid', snapshot: [selectRow('effort', ['low'], 'low')] })

    expect(hook.result.current?.tab).toBeUndefined()
  })

  it('does not take Tab for a switch row named effort', () => {
    const { hook } = setup({
      agent: 'droid',
      snapshot: [specRow({ id: 'effort', category: 'thought_level' })]
    })

    expect(hook.result.current?.tab).toBeUndefined()
  })

  it('offers no fast control: Tab and Ctrl+N only ever set the model or the effort', () => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [
        selectRow('model', ['droid-core', 'droid-core-fast'], 'droid-core'),
        selectRow('effort', EFFORTS, 'low')
      ]
    })

    hook.result.current?.tab?.()
    hook.result.current?.ctrlN?.()

    expect(setOption.mock.calls).toEqual([
      ['effort', 'medium'],
      ['model', 'droid-core-fast']
    ])
  })
})

describe('useNativeChatDroidComposerKeys: Ctrl+N', () => {
  it.each([
    ['haiku', 'sonnet'],
    ['sonnet', 'opus'],
    ['opus', 'haiku']
  ] as const)('moves the model %s to %s in the menu order, wrapping at the end', (from, to) => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [selectRow('model', MODELS, from)]
    })

    hook.result.current?.ctrlN?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('model', to)
  })

  it('walks the order of the model row itself, not an alphabetical one', () => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [selectRow('model', ['zeta', 'alpha', 'mid'], 'zeta')]
    })

    hook.result.current?.ctrlN?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('model', 'alpha')
  })

  it('takes a cold chat that names no model to the first one in the menu', () => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [selectRow('model', MODELS, undefined)]
    })

    hook.result.current?.ctrlN?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('model', 'haiku')
  })

  it('follows the newest snapshot, so the next press moves on from the last', () => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [selectRow('model', MODELS, 'haiku')]
    })
    hook.rerender({ snapshot: [selectRow('model', MODELS, 'sonnet')] })

    hook.result.current?.ctrlN?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('model', 'opus')
  })

  it.each([
    ['haiku', ['sonnet'], 'opus'],
    ['opus', ['haiku'], 'sonnet'],
    ['sonnet', ['opus'], 'haiku'],
    ['haiku', ['sonnet', 'unlisted'], 'opus']
  ] as const)(
    'moves the model %s past the refused %j to %s, wrapping at the end',
    (from, refused, to) => {
      const { hook, setOption } = setup({
        agent: 'droid',
        snapshot: [selectRow('model', MODELS, from)],
        refusedModelIds: refused
      })

      hook.result.current?.ctrlN?.()

      expect(setOption).toHaveBeenCalledExactlyOnceWith('model', to)
    }
  )

  it('starts a cold chat at the first model that was not refused', () => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [selectRow('model', MODELS, undefined)],
      refusedModelIds: ['haiku']
    })

    hook.result.current?.ctrlN?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('model', 'sonnet')
  })

  it('takes the key only while a model is left to move to', () => {
    const { hook } = setup({
      agent: 'droid',
      snapshot: [selectRow('model', MODELS, 'haiku')],
      refusedModelIds: ['sonnet', 'opus']
    })

    expect(hook.result.current?.ctrlN).toBeUndefined()
  })

  it('leaves the effort cycle alone, whatever models were refused', () => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [selectRow('model', MODELS, 'haiku'), selectRow('effort', EFFORTS, 'off')],
      refusedModelIds: [...EFFORTS]
    })

    hook.result.current?.tab?.()

    expect(setOption).toHaveBeenCalledExactlyOnceWith('effort', 'low')
  })

  it('claims no key without a model row, with one model, or while the model cannot be set', () => {
    const none = setup({ agent: 'droid', snapshot: [selectRow('effort', EFFORTS, 'low')] })
    expect(none.hook.result.current?.ctrlN).toBeUndefined()

    const single = setup({ agent: 'droid', snapshot: [selectRow('model', ['haiku'], 'haiku')] })
    expect(single.hook.result.current?.ctrlN).toBeUndefined()

    const locked = setup({
      agent: 'droid',
      snapshot: [
        selectRow('model', MODELS, 'haiku', {
          settable: false,
          disabledReason: 'available-after-session-start'
        })
      ]
    })
    expect(locked.hook.result.current?.ctrlN).toBeUndefined()
  })

  it('is wired beside Tab, Shift+Tab and Ctrl+L, each setting its own option', () => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: [
        selectRow('model', MODELS, 'haiku'),
        selectRow('effort', EFFORTS, 'off'),
        specRow()
      ],
      autonomy: autonomy('low')
    })

    hook.result.current?.ctrlN?.()
    hook.result.current?.tab?.()
    hook.result.current?.shiftTab?.()
    hook.result.current?.ctrlL?.()

    expect(setOption.mock.calls).toEqual([
      ['model', 'sonnet'],
      ['effort', 'low'],
      ['planMode', true],
      ['autonomyLevel', 'medium']
    ])
  })
})

describe('useNativeChatDroidComposerKeys: every other agent keeps Tab and Ctrl+N', () => {
  it.each(['claude', 'codex', 'pi', 'grok', 'opencode', 'omp', 'gemini'])(
    '%s: claims no key, running or not, even with model and effort rows',
    (agent) => {
      const snapshot = [selectRow('model', MODELS, 'haiku'), selectRow('effort', EFFORTS, 'low')]
      for (const isWorking of [false, true]) {
        const { hook, setOption } = setup({ agent, snapshot, autonomy: autonomy('low'), isWorking })

        expect(hook.result.current).toBeUndefined()
        expect(setOption).not.toHaveBeenCalled()
      }
    }
  )

  it('a composer with no agent claims no key', () => {
    const snapshot = [selectRow('model', MODELS, 'haiku'), selectRow('effort', EFFORTS, 'low')]
    const surface: SessionOptionsSurface = {
      getSnapshot: () => snapshot,
      setOption: vi.fn(async () => ({ snapshot })),
      invokeAction: async () => ({ snapshot }),
      subscribe: () => () => {}
    }
    const hook = renderHook(() =>
      useNativeChatDroidComposerKeys({ agent: undefined, snapshot, surface, isWorking: true })
    )

    expect(hook.result.current).toBeUndefined()
  })
})

const HELD_KEYS = ['shiftTab', 'ctrlL', 'tab', 'ctrlN'] as const

describe('useNativeChatDroidComposerKeys: while a turn runs', () => {
  const RICH = [selectRow('model', MODELS, 'haiku'), selectRow('effort', EFFORTS, 'low'), specRow()]

  it.each(HELD_KEYS)('holds %s: it is claimed and changes nothing', (key) => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: RICH,
      autonomy: autonomy('low'),
      isWorking: true
    })

    expect(hook.result.current?.[key]).toBeTypeOf('function')
    hook.result.current?.[key]?.()

    expect(setOption).not.toHaveBeenCalled()
  })

  it('holds all four even when the chat has nothing for them to act on', () => {
    const { hook, setOption } = setup({ agent: 'droid', snapshot: [], isWorking: true })

    for (const key of HELD_KEYS) {
      expect(hook.result.current?.[key]).toBeTypeOf('function')
      hook.result.current?.[key]?.()
    }
    expect(setOption).not.toHaveBeenCalled()
  })

  it('holds all four with no options surface at all', () => {
    const hook = renderHook(() =>
      useNativeChatDroidComposerKeys({
        agent: 'droid',
        snapshot: [],
        surface: null,
        isWorking: true
      })
    )

    expect(HELD_KEYS.map((key) => typeof hook.result.current?.[key])).toEqual([
      'function',
      'function',
      'function',
      'function'
    ])
  })

  it('claims no other key, so Escape still interrupts and Enter still sends', () => {
    const { hook } = setup({
      agent: 'droid',
      snapshot: RICH,
      autonomy: autonomy('low'),
      isWorking: true
    })

    expect(Object.keys(hook.result.current ?? {}).toSorted()).toEqual([...HELD_KEYS].toSorted())
  })

  it('works again, from where the chat stands, when the turn ends', () => {
    const { hook, setOption } = setup({
      agent: 'droid',
      snapshot: RICH,
      autonomy: autonomy('low'),
      isWorking: true
    })
    for (const key of HELD_KEYS) {
      hook.result.current?.[key]?.()
    }
    expect(setOption).not.toHaveBeenCalled()

    hook.rerender({ snapshot: RICH, isWorking: false })
    for (const key of HELD_KEYS) {
      hook.result.current?.[key]?.()
    }

    expect(setOption.mock.calls).toEqual([
      ['planMode', true],
      ['autonomyLevel', 'medium'],
      ['effort', 'medium'],
      ['model', 'sonnet']
    ])
  })

  it('holds the keys again when the next turn starts', () => {
    const { hook, setOption } = setup({ agent: 'droid', snapshot: RICH, isWorking: false })
    hook.rerender({ snapshot: RICH, isWorking: true })

    for (const key of HELD_KEYS) {
      hook.result.current?.[key]?.()
    }

    expect(setOption).not.toHaveBeenCalled()
  })
})
