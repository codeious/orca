// The Spec model and effort of a Droid chat are drawn beside the catalog's options: set and cleared
// on their own, never moving the main model or effort, and offered to no other agent.

import { describe, expect, it } from 'vitest'
import type { AgentSessionModelCatalogResult } from './agent-session-wire'
import { DROID_SPEC_SAME_AS_MAIN } from './droid-spec-pair-options'
import {
  canSetDroidSpecPairOption,
  droidSpecPairSurface,
  withDroidSpecPairPick
} from './droid-spec-pair-view'
import { structuredAgentSessionOptionView } from './structured-agent-session-option-view'
import { structuredAgentSessionSeedCatalog } from './structured-agent-session-seed-catalog'
import {
  applyStructuredAgentSessionModelCatalog,
  applyStructuredAgentSessionOptions,
  commitStructuredAgentSessionOptionValues,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionSnapshot
} from './structured-agent-session-options'

const HOST_CATALOG: AgentSessionModelCatalogResult = {
  origin: 'probe',
  models: [
    {
      id: 'main-model',
      label: 'Main Model',
      isDefault: true,
      defaultEffort: 'high',
      efforts: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' }
      ]
    },
    {
      id: 'cheap-model',
      label: 'Cheap Model',
      isDefault: false,
      efforts: [
        { value: 'off', label: 'Off' },
        { value: 'medium', label: 'Medium' }
      ]
    }
  ],
  fetchedAt: 1_000,
  listingNamesConfiguredModel: true
}

function coldChat(agent: string) {
  const seed = structuredAgentSessionSeedCatalog(agent)
  const state = applyStructuredAgentSessionModelCatalog(
    createStructuredAgentSessionOptionState(agent, seed),
    seed,
    HOST_CATALOG,
    { newLaunch: true }
  )
  return { seed, state }
}

function surfaceOf(state: ReturnType<typeof coldChat>['state'], held: Record<string, string> = {}) {
  return droidSpecPairSurface(
    structuredAgentSessionOptionView(state, undefined, held),
    undefined,
    held,
    true
  )
}

function choiceValues(choices: { value: string }[] | undefined) {
  return choices?.map((choice) => choice.value)
}

describe('the Spec pair control of a Droid chat', () => {
  it('lists every host model once the host has listed them, with nothing set', () => {
    const surface = surfaceOf(coldChat('droid').state)

    expect(surface).toMatchObject({
      model: null,
      effort: null,
      settable: true
    })
    expect(choiceValues(surface?.modelChoices)).toEqual(['main-model', 'cheap-model'])
  })

  it('is offered to no other agent', () => {
    for (const agent of ['claude', 'codex', 'grok', 'opencode', 'pi']) {
      expect([agent, surfaceOf(coldChat(agent).state)]).toEqual([agent, null])
    }
  })

  it('is not offered before the host has listed models', () => {
    const seed = structuredAgentSessionSeedCatalog('droid')

    expect(surfaceOf(createStructuredAgentSessionOptionState('droid', seed))).toBeNull()
  })

  it('shows the pair a session reports and leaves the main model and effort as they were', () => {
    const { seed, state } = coldChat('droid')
    const main = {
      models: [{ id: 'main-model', label: 'Main Model', isDefault: true, efforts: [] }],
      current: {
        model: 'main-model',
        effort: 'high',
        planMode: true,
        confirmed: ['model']
      }
    }
    const without = applyStructuredAgentSessionOptions(state, seed, main)
    const withPair = applyStructuredAgentSessionOptions(state, seed, {
      ...main,
      current: { ...main.current, specModel: 'cheap-model', specEffort: 'off' }
    })

    expect(surfaceOf(withPair)).toMatchObject({
      model: 'cheap-model',
      effort: 'off'
    })
    expect(surfaceOf(without)).toMatchObject({ model: null, effort: null })
    const mainPills = (s: typeof state) =>
      structuredAgentSessionOptionSnapshot(s).filter(
        (row) => row.id === 'model' || row.id === 'effort'
      )
    expect(mainPills(withPair)).toEqual(mainPills(without))
  })

  it('offers the efforts of the Spec model, else of the main model', () => {
    const { state } = coldChat('droid')
    const mainModel = commitStructuredAgentSessionOptionValues(state, {
      model: 'main-model'
    })

    expect(choiceValues(surfaceOf(mainModel)?.effortChoices)).toEqual(['low', 'high'])
    expect(
      choiceValues(
        surfaceOf(withDroidSpecPairPick(mainModel, 'specModel', 'cheap-model'))?.effortChoices
      )
    ).toEqual(['off', 'medium'])
  })

  it('names a held pick before the launch has a fence to send it against', () => {
    const { state } = coldChat('droid')
    const held = { specModel: 'cheap-model', specEffort: 'off' }

    expect(surfaceOf(state, held)).toMatchObject({
      model: 'cheap-model',
      effort: 'off'
    })
  })

  it('shows a held clear as cleared, and a held clear of the model takes the effort with it', () => {
    const set = withDroidSpecPairPick(
      withDroidSpecPairPick(coldChat('droid').state, 'specModel', 'cheap-model'),
      'specEffort',
      'off'
    )

    expect(surfaceOf(set, { specModel: DROID_SPEC_SAME_AS_MAIN })).toMatchObject({
      model: null,
      effort: null
    })
    expect(surfaceOf(set, { specEffort: DROID_SPEC_SAME_AS_MAIN })).toMatchObject({
      model: 'cheap-model',
      effort: null
    })
  })

  it('refuses a model or effort the lists do not name, and takes the clear choice', () => {
    const { state } = coldChat('droid')
    const picked = withDroidSpecPairPick(state, 'specModel', 'cheap-model')

    expect(canSetDroidSpecPairOption(state, 'specModel', 'cheap-model')).toBe(true)
    expect(canSetDroidSpecPairOption(state, 'specModel', 'no-such-model')).toBe(false)
    expect(canSetDroidSpecPairOption(state, 'specModel', DROID_SPEC_SAME_AS_MAIN)).toBe(true)
    expect(canSetDroidSpecPairOption(picked, 'specEffort', 'off')).toBe(true)
    expect(canSetDroidSpecPairOption(picked, 'specEffort', 'high')).toBe(false)
    expect(canSetDroidSpecPairOption(picked, 'specEffort', DROID_SPEC_SAME_AS_MAIN)).toBe(true)
    expect(canSetDroidSpecPairOption(coldChat('claude').state, 'specModel', 'cheap-model')).toBe(
      false
    )
  })

  it('keeps a Spec model that the host stopped listing, so the control still names what is set', () => {
    const { seed, state } = coldChat('droid')
    const live = applyStructuredAgentSessionOptions(state, seed, {
      models: [{ id: 'main-model', label: 'Main Model', isDefault: true, efforts: [] }],
      current: {
        model: 'main-model',
        planMode: true,
        specModel: 'retired-model'
      }
    })

    expect(choiceValues(surfaceOf(live)?.modelChoices)).toContain('retired-model')
    expect(surfaceOf(live)).toMatchObject({ model: 'retired-model' })
  })
})

describe('a Spec pair pick applied to the state', () => {
  it('sets a model and an effort, clears the effort alone, and clears the model with its effort', () => {
    const { state } = coldChat('droid')
    const both = withDroidSpecPairPick(
      withDroidSpecPairPick(state, 'specModel', 'cheap-model'),
      'specEffort',
      'off'
    )
    const noEffort = withDroidSpecPairPick(both, 'specEffort', DROID_SPEC_SAME_AS_MAIN)
    const none = withDroidSpecPairPick(both, 'specModel', DROID_SPEC_SAME_AS_MAIN)

    expect(surfaceOf(both)).toMatchObject({
      model: 'cheap-model',
      effort: 'off'
    })
    expect(surfaceOf(noEffort)).toMatchObject({
      model: 'cheap-model',
      effort: null
    })
    expect(surfaceOf(none)).toMatchObject({ model: null, effort: null })
  })

  it('moves no main pill', () => {
    const { state } = coldChat('droid')
    const picked = withDroidSpecPairPick(state, 'specModel', 'cheap-model')

    expect(structuredAgentSessionOptionSnapshot(picked)).toEqual(
      structuredAgentSessionOptionSnapshot(state)
    )
    expect(picked.record).toBe(state.record)
  })
})
