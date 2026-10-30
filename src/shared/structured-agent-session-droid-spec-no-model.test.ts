// Droid's own listing marks no default model, so a cold chat names none and its pill reads "Model".
// Spec belongs to the session, not a model: its switch must still be there, hold a pick, and keep
// it when a model is chosen afterwards.

import { describe, expect, it } from 'vitest'
import type { AgentSessionModelCatalogResult } from './agent-session-wire'
import { structuredAgentSessionOptionView } from './structured-agent-session-option-view'
import { structuredAgentSessionSeedCatalog } from './structured-agent-session-seed-catalog'
import {
  applyStructuredAgentSessionModelCatalog,
  applyStructuredAgentSessionOptions,
  canSetStructuredAgentSessionOption,
  commitStructuredAgentSessionOption,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionSnapshot
} from './structured-agent-session-options'

const OTHER_AGENTS = ['claude', 'codex', 'grok', 'opencode', 'pi'] as const

const UNNAMED_DEFAULT_CATALOG: AgentSessionModelCatalogResult = {
  origin: 'probe',
  models: [
    {
      id: 'main-model',
      label: 'Main Model',
      isDefault: false,
      efforts: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' }
      ]
    },
    { id: 'cheap-model', label: 'Cheap Model', isDefault: false, efforts: [] }
  ],
  fetchedAt: 1_000
}

function coldChat(agent: string) {
  const seed = structuredAgentSessionSeedCatalog(agent)
  const state = applyStructuredAgentSessionModelCatalog(
    createStructuredAgentSessionOptionState(agent, seed),
    seed,
    UNNAMED_DEFAULT_CATALOG,
    { newLaunch: true }
  )
  return { seed, state }
}

function row(state: ReturnType<typeof coldChat>['state'], id: string) {
  return structuredAgentSessionOptionSnapshot(state).find((entry) => entry.id === id)
}

describe('the Spec switch of a Droid chat whose model is not named yet', () => {
  it('is offered and settable beside a model pill that names nothing, with no effort row', () => {
    const { state } = coldChat('droid')

    expect(row(state, 'model')?.kind).not.toHaveProperty('currentValue')
    expect(row(state, 'planMode')).toMatchObject({ label: 'Spec', settable: true })
    expect(row(state, 'effort')).toBeUndefined()
    expect(canSetStructuredAgentSessionOption(state, 'planMode', true)).toBe(true)
  })

  it('reads as the pick without naming a model', () => {
    const { state } = coldChat('droid')

    const on = commitStructuredAgentSessionOption(state, 'planMode', 'true')

    expect(row(on, 'planMode')).toMatchObject({
      kind: { type: 'boolean', currentValue: true },
      valueSource: 'dispatched'
    })
    expect(row(on, 'model')?.kind).not.toHaveProperty('currentValue')
    const off = commitStructuredAgentSessionOption(on, 'planMode', 'false')
    expect(row(off, 'planMode')).toMatchObject({ kind: { type: 'boolean', currentValue: false } })
  })

  it('keeps the pick when a model is chosen afterwards', () => {
    const { state } = coldChat('droid')
    const on = commitStructuredAgentSessionOption(state, 'planMode', 'true')

    const picked = commitStructuredAgentSessionOption(on, 'model', 'cheap-model')

    expect(row(picked, 'model')?.kind).toMatchObject({ currentValue: 'cheap-model' })
    expect(row(picked, 'planMode')).toMatchObject({ kind: { type: 'boolean', currentValue: true } })
  })

  it('shows a held pick the same way, so a launch with no fence yet still reads it', () => {
    const { state } = coldChat('droid')

    const withSpec = structuredAgentSessionOptionView(state, undefined, { planMode: 'true' })
    const withBoth = structuredAgentSessionOptionView(state, undefined, {
      planMode: 'true',
      model: 'cheap-model'
    })

    expect(row(withSpec, 'planMode')).toMatchObject({ kind: { currentValue: true } })
    expect(row(withBoth, 'planMode')).toMatchObject({ kind: { currentValue: true } })
    expect(row(withBoth, 'model')?.kind).toMatchObject({ currentValue: 'cheap-model' })
    expect(
      structuredAgentSessionOptionSnapshot(state).find((r) => r.id === 'planMode')
    ).toMatchObject({ kind: { currentValue: false } })
  })

  it('reads a saved Spec from a report that names no model, still without naming one', () => {
    const { seed, state } = coldChat('droid')

    const live = applyStructuredAgentSessionOptions(state, seed, {
      models: [{ id: 'main-model', label: 'Main Model', isDefault: false, efforts: [] }],
      current: { planMode: true }
    })

    expect(row(live, 'planMode')).toMatchObject({
      kind: { type: 'boolean', currentValue: true },
      valueSource: 'reported'
    })
    expect(row(live, 'model')?.kind).not.toHaveProperty('currentValue')
  })

  it('lets a later no-model report turn a picked Spec off', () => {
    const { seed, state } = coldChat('droid')
    const on = commitStructuredAgentSessionOption(state, 'planMode', 'true')

    const live = applyStructuredAgentSessionOptions(on, seed, {
      models: [{ id: 'main-model', label: 'Main Model', isDefault: false, efforts: [] }],
      current: { planMode: false }
    })

    expect(row(live, 'planMode')).toMatchObject({ kind: { currentValue: false } })
  })

  it('lets the session report decide, so an earlier pick never outlives it', () => {
    const { seed, state } = coldChat('droid')
    const on = commitStructuredAgentSessionOption(state, 'planMode', 'true')

    const live = applyStructuredAgentSessionOptions(on, seed, {
      models: [{ id: 'main-model', label: 'Main Model', isDefault: true, efforts: [] }],
      current: { model: 'main-model', planMode: false, confirmed: ['model', 'planMode'] }
    })

    expect(row(live, 'planMode')).toMatchObject({ kind: { type: 'boolean', currentValue: false } })
  })
})

describe('every other agent with no model named', () => {
  it.each(OTHER_AGENTS)('%s: still has no Spec row', (agent) => {
    const { state } = coldChat(agent)

    expect(row(state, 'planMode')).toBeUndefined()
    expect(canSetStructuredAgentSessionOption(state, 'planMode', true)).toBe(false)
  })
})
