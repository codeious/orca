// Droid's Spec switch is offered from the first frame, before any session reports `planMode`. Every
// other agent keeps offering a row only once its own session reports one, and none gets a Spec pair.

import { describe, expect, it } from 'vitest'
import type { AgentSessionModelCatalogResult } from './agent-session-wire'
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
    { id: 'cheap-model', label: 'Cheap Model', isDefault: false, efforts: [] }
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

function descriptor(state: ReturnType<typeof coldChat>['state'], id: string) {
  return structuredAgentSessionOptionSnapshot(state).find((entry) => entry.id === id)
}

describe('the Spec switch of a Droid chat that has not started', () => {
  it('is a settable on/off option once the host lists models, with no live report yet', () => {
    const { state } = coldChat('droid')

    expect(descriptor(state, 'planMode')).toMatchObject({
      label: 'Spec',
      kind: { type: 'boolean' }
    })
    expect(canSetStructuredAgentSessionOption(state, 'planMode', true)).toBe(true)
  })

  it('reads off until it is picked, then reads as the pick', () => {
    const { state } = coldChat('droid')
    const before = descriptor(state, 'planMode')
    expect(before?.kind.type === 'boolean' && before.kind.currentValue).not.toBe(true)

    const on = commitStructuredAgentSessionOption(state, 'planMode', 'true')
    expect(descriptor(on, 'planMode')).toMatchObject({
      kind: { type: 'boolean', currentValue: true },
      valueSource: 'dispatched'
    })

    const off = commitStructuredAgentSessionOption(on, 'planMode', 'false')
    expect(descriptor(off, 'planMode')).toMatchObject({
      kind: { type: 'boolean', currentValue: false }
    })
  })

  it('stays one row when the session reports, and the report decides its value', () => {
    const { seed, state } = coldChat('droid')
    const live = applyStructuredAgentSessionOptions(state, seed, {
      models: [{ id: 'main-model', label: 'Main Model', isDefault: true, efforts: [] }],
      current: { model: 'main-model', planMode: true, confirmed: ['model', 'planMode'] }
    })

    const rows = structuredAgentSessionOptionSnapshot(live).filter((row) => row.id === 'planMode')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: { type: 'boolean', currentValue: true } })
  })

  it('never lists the Spec model or effort as a catalog option, reported or not', () => {
    const { seed, state } = coldChat('droid')
    const live = applyStructuredAgentSessionOptions(state, seed, {
      models: [{ id: 'main-model', label: 'Main Model', isDefault: true, efforts: [] }],
      current: {
        model: 'main-model',
        planMode: true,
        specModel: 'cheap-model',
        specEffort: 'low',
        confirmed: ['model']
      }
    })

    for (const snapshot of [
      structuredAgentSessionOptionSnapshot(state),
      structuredAgentSessionOptionSnapshot(live)
    ]) {
      expect(snapshot.map((row) => row.id)).not.toContain('specModel')
      expect(snapshot.map((row) => row.id)).not.toContain('specEffort')
    }
  })
})

describe('every other agent before its session reports', () => {
  it.each(OTHER_AGENTS)('%s: has no Spec row and cannot set one', (agent) => {
    const { state } = coldChat(agent)

    expect(descriptor(state, 'planMode')).toBeUndefined()
    expect(canSetStructuredAgentSessionOption(state, 'planMode', true)).toBe(false)
    const ids = structuredAgentSessionOptionSnapshot(state).map((row) => row.id)
    expect(ids).not.toContain('specModel')
    expect(ids).not.toContain('specEffort')
  })

  it.each(OTHER_AGENTS)('%s: gets a Spec row only when its session reports planMode', (agent) => {
    const { seed, state } = coldChat(agent)
    const reported = applyStructuredAgentSessionOptions(state, seed, {
      models: [{ id: 'main-model', label: 'Main Model', isDefault: true, efforts: [] }],
      current: { model: 'main-model', planMode: false, confirmed: ['model'] }
    })
    const silent = applyStructuredAgentSessionOptions(state, seed, {
      models: [{ id: 'main-model', label: 'Main Model', isDefault: true, efforts: [] }],
      current: { model: 'main-model', confirmed: ['model'] }
    })

    expect(descriptor(reported, 'planMode')).toBeDefined()
    expect(descriptor(silent, 'planMode')).toBeUndefined()
  })
})
