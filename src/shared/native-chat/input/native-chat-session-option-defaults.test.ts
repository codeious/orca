import { describe, expect, it } from 'vitest'
import {
  applyNativeChatSessionOptionSettingsMutation,
  narrowStructuredLaunchSeedOptions,
  parseStructuredLaunchSeedOptions,
  resolveNativeChatSessionOptionDefaults,
  resolveStructuredLaunchSeedOptions,
  structuredLaunchRequestedOptions,
  structuredLaunchSeedOptions
} from './native-chat-session-option-defaults'
import { agentPickerChoiceSeeds } from '../../agent-launch-picker-defaults'
import type { PersistedNativeChatSessionOptions } from './native-chat-session-options'

it('saves a Spec pair without changing the Normal default and seeds both into a new chat', () => {
  const saved = applyNativeChatSessionOptionSettingsMutation(
    { droid: { model: 'sol', valuesByModel: { sol: { effort: 'high' } } } },
    {
      type: 'apply-picks',
      agent: 'droid',
      picks: [
        { modelId: 'sol', optionId: 'specModel', value: 'opus' },
        { modelId: 'sol', optionId: 'specEffort', value: 'xhigh' }
      ]
    }
  )
  expect(saved).toEqual({
    droid: {
      model: 'sol',
      valuesByModel: { sol: { effort: 'high' } },
      spec: { model: 'opus', effort: 'xhigh' }
    }
  })
  expect(resolveStructuredLaunchSeedOptions(saved, 'droid')).toEqual({
    model: 'sol',
    effort: 'high',
    specModel: 'opus',
    specEffort: 'xhigh'
  })
})

it('seeds a Spec-only default through storage parsing and the new-chat picker without inventing a Normal model', () => {
  const persisted = { droid: { spec: { model: 'opus', effort: 'xhigh' } } }
  const seed = resolveStructuredLaunchSeedOptions(persisted, 'droid')
  expect(seed).toEqual({ specModel: 'opus', specEffort: 'xhigh' })
  expect(parseStructuredLaunchSeedOptions(seed)).toEqual(seed)
  expect(
    agentPickerChoiceSeeds('droid', { nativeChatSessionOptions: persisted }).structured
  ).toMatchObject({
    options: { specModel: 'opus', specEffort: 'xhigh' }
  })
  expect(
    agentPickerChoiceSeeds('droid', { nativeChatSessionOptions: persisted }).structured
  ).not.toHaveProperty('model')
})

it('keeps the saved Spec pair when agent launch settings supply a different Normal model', () => {
  expect(
    structuredLaunchSeedOptions(
      {
        nativeChatSessionOptions: {
          droid: { model: 'old', spec: { model: 'opus', effort: 'xhigh' } }
        },
        agentLaunchChoices: { droid: { model: 'sol' } }
      },
      'droid'
    )
  ).toMatchObject({ model: 'sol', specModel: 'opus', specEffort: 'xhigh' })
})

it('keeps the Spec pair when the Normal default changes and replaces its model-specific effort', () => {
  const persisted = {
    droid: {
      model: 'old',
      valuesByModel: { old: { effort: 'low' }, sol: { effort: 'high' } },
      spec: { model: 'opus', effort: 'xhigh' }
    }
  }
  const saved = applyNativeChatSessionOptionSettingsMutation(persisted, {
    type: 'apply-picks',
    agent: 'droid',
    picks: [{ modelId: 'sol', optionId: 'model', value: 'sol' }]
  })
  expect(resolveStructuredLaunchSeedOptions(saved, 'droid')).toEqual({
    model: 'sol',
    effort: 'high',
    specModel: 'opus',
    specEffort: 'xhigh'
  })
  expect(
    structuredLaunchRequestedOptions({
      explicit: { model: 'old', effort: 'low', specModel: 'opus', specEffort: 'xhigh' },
      held: { model: 'sol' }
    })
  ).toEqual({ model: 'sol', specModel: 'opus', specEffort: 'xhigh' })
})

it('replaces the Spec effort with the reported effort when choosing a new Spec model', () => {
  const saved = applyNativeChatSessionOptionSettingsMutation(
    { droid: { spec: { model: 'opus', effort: 'xhigh' } } },
    {
      type: 'apply-picks',
      agent: 'droid',
      picks: [
        { modelId: 'sol', optionId: 'specModel', value: 'sonnet' },
        { modelId: 'sol', optionId: 'specEffort', value: 'high' }
      ]
    }
  )
  expect(resolveStructuredLaunchSeedOptions(saved, 'droid')).toEqual({
    specModel: 'sonnet',
    specEffort: 'high'
  })
})

const persistedGrok = (
  model: string | undefined,
  valuesByModel: Record<string, Record<string, string>> = {}
): PersistedNativeChatSessionOptions => ({
  grok: { ...(model ? { model } : {}), valuesByModel }
})

describe('older clients clearing a missing model', () => {
  it.each(['grok', 'omp'] as const)(
    'keeps the remembered %s model and its launch options',
    (agent) => {
      const persisted = {
        [agent]: { model: 'retired', valuesByModel: { retired: { effort: 'low' } } }
      }
      expect(
        applyNativeChatSessionOptionSettingsMutation(persisted, {
          type: 'clear-model-if-missing',
          agent,
          availableModelIds: ['current']
        })
      ).toBeNull()
      expect(resolveNativeChatSessionOptionDefaults(persisted, agent)).toEqual({
        model: 'retired',
        effort: 'low'
      })
    }
  )
})

describe('resolveNativeChatSessionOptionDefaults', () => {
  it('emits nothing until a model is explicitly picked, preserving the CLI default', () => {
    expect(resolveNativeChatSessionOptionDefaults(undefined, 'grok')).toBeUndefined()
    expect(resolveNativeChatSessionOptionDefaults(persistedGrok(undefined), 'grok')).toBeUndefined()
    expect(resolveNativeChatSessionOptionDefaults(persistedGrok('   '), 'grok')).toBeUndefined()
  })

  it('returns an unlisted saved id verbatim', () => {
    expect(resolveNativeChatSessionOptionDefaults(persistedGrok('grok-build'), 'grok')).toEqual({
      model: 'grok-build'
    })
  })
})

describe('resolveStructuredLaunchSeedOptions', () => {
  const persistedCodex = (
    valuesByModel: Record<string, Record<string, string | boolean>>
  ): PersistedNativeChatSessionOptions =>
    ({ codex: { model: 'gpt-5.6-sol', valuesByModel } }) as PersistedNativeChatSessionOptions

  it('seeds the saved model and effort a structured create must apply', () => {
    expect(
      resolveStructuredLaunchSeedOptions(
        persistedCodex({ 'gpt-5.6-sol': { effort: 'medium' } }),
        'codex'
      )
    ).toEqual({ model: 'gpt-5.6-sol', effort: 'medium' })
  })

  it('encodes Fast mode while dropping ids the providers only accept mid-session', () => {
    expect(
      resolveStructuredLaunchSeedOptions(
        persistedCodex({
          'gpt-5.6-sol': { effort: 'high', fastMode: true, personality: 'concise' }
        }),
        'codex'
      )
    ).toEqual({ model: 'gpt-5.6-sol', effort: 'high', fastMode: 'true' })
  })

  it('seeds a saved service tier', () => {
    expect(
      resolveStructuredLaunchSeedOptions(
        persistedCodex({ 'gpt-5.6-sol': { serviceTier: 'ultrafast' } }),
        'codex'
      )
    ).toEqual({ model: 'gpt-5.6-sol', serviceTier: 'ultrafast' })
  })

  it('drops a seeded id whose persisted value is not a usable string', () => {
    // User-writable settings may contain non-string options; never emit them into the durable string record.
    expect(
      resolveStructuredLaunchSeedOptions(
        persistedCodex({ 'gpt-5.6-sol': { effort: true } }),
        'codex'
      )
    ).toEqual({ model: 'gpt-5.6-sol' })
    expect(
      resolveStructuredLaunchSeedOptions(
        persistedCodex({ 'gpt-5.6-sol': { effort: '  ' } }),
        'codex'
      )
    ).toEqual({ model: 'gpt-5.6-sol' })
  })

  it('seeds nothing when the stored values empty the model out', () => {
    // valuesByModel can blank the model; bounded-string validation then throws outside wire refusals and strands launch fallback.
    expect(
      resolveStructuredLaunchSeedOptions(persistedCodex({ 'gpt-5.6-sol': { model: '' } }), 'codex')
    ).toBeUndefined()
  })

  it('seeds nothing until a model is picked, so the CLI default survives', () => {
    expect(resolveStructuredLaunchSeedOptions(undefined, 'codex')).toBeUndefined()
    expect(
      resolveStructuredLaunchSeedOptions({ codex: { valuesByModel: {} } }, 'codex')
    ).toBeUndefined()
  })
})

describe('narrowStructuredLaunchSeedOptions', () => {
  it('keeps the seedable ids an explicit selection names', () => {
    expect(
      narrowStructuredLaunchSeedOptions({ model: 'opus', effort: 'high', fastMode: false })
    ).toEqual({
      model: 'opus',
      effort: 'high',
      fastMode: 'false'
    })
  })

  // Absent Fast preference must stay absent; defaulting true changes service tier without a user choice.
  it('seeds no fastMode at all when the user never picked one', () => {
    expect(narrowStructuredLaunchSeedOptions({ model: 'opus', effort: 'high' })).toEqual({
      model: 'opus',
      effort: 'high'
    })
  })

  it('drops ids no structured create may seed', () => {
    expect(narrowStructuredLaunchSeedOptions({ model: 'opus', mode: 'plan' })).toEqual({
      model: 'opus'
    })
  })

  it.each([
    ['nothing at all', {}],
    ['whitespace only', { model: '   ', effort: '\t' }],
    ['no usable string', { model: 5, effort: null }],
    ['undefined', undefined]
  ])('resolves %s to undefined rather than {}', (_name, values) => {
    // Empty maps fail the durable guard outside wire-refusal handling, stranding fallback.
    expect(narrowStructuredLaunchSeedOptions(values as never)).toBeUndefined()
  })
})
