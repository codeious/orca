// The autonomy level of a Droid chat is drawn beside the catalog's options: held, picked and
// reported on its own, never one of a model's options, and offered to no other agent.

import { describe, expect, it } from 'vitest'
import type { AgentSessionOptionsResult } from './agent-session-wire'
import { droidAutonomyOf } from './droid-autonomy-options'
import {
  canSetDroidAutonomyOption,
  droidAutonomySurface,
  isDroidDraftOptionId,
  withDroidAutonomyPick
} from './droid-autonomy-view'
import { commitStructuredAgentSessionPick } from './droid-spec-pair-view'
import { structuredAgentSessionSeedCatalog } from './structured-agent-session-seed-catalog'
import {
  applyStructuredAgentSessionOptions,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionPicks,
  structuredAgentSessionOptionSnapshot,
  type StructuredAgentSessionOptionState
} from './structured-agent-session-options'

const FOUR = ['off', 'low', 'medium', 'high']

function answer(current: AgentSessionOptionsResult['current']): AgentSessionOptionsResult {
  return { models: [{ id: 'main', label: 'Main', isDefault: true, efforts: [] }], current }
}

function read(
  agent: string,
  current: AgentSessionOptionsResult['current'],
  from?: StructuredAgentSessionOptionState
): StructuredAgentSessionOptionState {
  const seed = structuredAgentSessionSeedCatalog(agent)
  if (!seed) {
    throw new Error(`no seed catalog for ${agent}`)
  }
  return applyStructuredAgentSessionOptions(
    from ?? createStructuredAgentSessionOptionState(agent, seed),
    seed,
    answer(current)
  )
}

describe('the autonomy control before the first message', () => {
  it('offers the four levels in order when the host names the level the next start sends', () => {
    const state = read('droid', { model: 'main', autonomyLevel: 'high' })

    expect(droidAutonomySurface(state, {}, true)).toEqual({
      level: 'high',
      levels: FOUR,
      settable: true
    })
  })

  it('has nothing to draw until the host names a level', () => {
    expect(droidAutonomySurface(read('droid', { model: 'main' }), {}, true)).toBeNull()
  })

  it('shows a held pick in place of the level the host named', () => {
    const state = read('droid', { autonomyLevel: 'high' })

    expect(droidAutonomySurface(state, { autonomyLevel: 'low' }, true)?.level).toBe('low')
  })

  it('cannot be set while the chat accepts no pick', () => {
    const state = read('droid', { autonomyLevel: 'high' })

    expect(droidAutonomySurface(state, {}, false)?.settable).toBe(false)
  })

  it('takes a pick of any of the four and nothing else', () => {
    const state = read('droid', { autonomyLevel: 'high' })

    expect(FOUR.map((level) => canSetDroidAutonomyOption(state, {}, level))).toEqual([
      true,
      true,
      true,
      true
    ])
    expect(canSetDroidAutonomyOption(state, {}, 'ultra')).toBe(false)
    expect(canSetDroidAutonomyOption(state, {}, '')).toBe(false)
  })

  it('takes no pick while another option is still being sent', () => {
    const state = { ...read('droid', { autonomyLevel: 'high' }), pendingId: 'model' }

    expect(canSetDroidAutonomyOption(state, {}, 'low')).toBe(false)
  })
})

describe('the autonomy control after the session started', () => {
  it('offers only the levels Droid reports, and shows the one it holds', () => {
    const state = read('droid', {
      autonomyLevel: 'low',
      availableAutonomyLevels: ['off', 'low']
    })

    expect(droidAutonomySurface(state, {}, true)).toEqual({
      level: 'low',
      levels: ['off', 'low'],
      settable: true
    })
    expect(canSetDroidAutonomyOption(state, {}, 'low')).toBe(true)
    expect(canSetDroidAutonomyOption(state, {}, 'medium')).toBe(false)
    expect(canSetDroidAutonomyOption(state, {}, 'high')).toBe(false)
  })

  it('offers all four when Droid reports all four, as it does after a lowered level', () => {
    const state = read('droid', { autonomyLevel: 'low', availableAutonomyLevels: FOUR })

    expect(droidAutonomySurface(state, {}, true)?.levels).toEqual(FOUR)
  })

  it('shows the level Droid reports when it lowered the one the user had picked', () => {
    const picked = withDroidAutonomyPick(read('droid', { autonomyLevel: 'high' }), 'high')
    expect(droidAutonomySurface(picked, {}, true)?.level).toBe('high')

    const lowered = read('droid', { autonomyLevel: 'low', availableAutonomyLevels: FOUR }, picked)

    expect(droidAutonomySurface(lowered, {}, true)?.level).toBe('low')
  })

  it('goes back to the four levels when a later answer is from a chat with no child', () => {
    const live = read('droid', { autonomyLevel: 'low', availableAutonomyLevels: ['off', 'low'] })

    const atRest = read('droid', { autonomyLevel: 'low' }, live)

    expect(droidAutonomySurface(atRest, {}, true)?.levels).toEqual(FOUR)
  })

  it('drops a level Droid does not define from what it reports', () => {
    expect(
      droidAutonomyOf({ autonomyLevel: 'low', availableAutonomyLevels: ['off', 'ultra', 'low'] })
    ).toEqual({ level: 'low', available: ['off', 'low'] })
    expect(droidAutonomyOf({ autonomyLevel: 'ultra' })).toBeUndefined()
  })
})

describe('a picked autonomy level', () => {
  it('is the shown level and touches no model option', () => {
    const before = read('droid', { model: 'main', autonomyLevel: 'high' })

    const after = withDroidAutonomyPick(before, 'medium')

    expect(droidAutonomySurface(after, {}, true)?.level).toBe('medium')
    expect(after.record).toBe(before.record)
    expect(structuredAgentSessionOptionSnapshot(after).map((row) => row.id)).toEqual(
      structuredAgentSessionOptionSnapshot(before).map((row) => row.id)
    )
  })

  it('is never remembered as a per-model pick for the next launch', () => {
    const state = read('droid', { model: 'main', autonomyLevel: 'high' })

    expect(
      structuredAgentSessionOptionPicks(state, { autonomyLevel: 'low', model: 'main' })
    ).toEqual([{ modelId: 'main', optionId: 'model', value: 'main' }])
  })
})

describe('an autonomy level the launch holds or has had accepted', () => {
  it('shows the level the launch had accepted until the next answer, and a held pick over it', () => {
    const state = read('droid', { autonomyLevel: 'high' })

    expect(droidAutonomySurface(state, {}, true, { autonomyLevel: 'low' })?.level).toBe('low')
    expect(
      droidAutonomySurface(state, { autonomyLevel: 'medium' }, true, { autonomyLevel: 'low' })
        ?.level
    ).toBe('medium')
  })

  it('gives way to the level Droid reports once a child has answered', () => {
    const state = read('droid', { autonomyLevel: 'low', availableAutonomyLevels: FOUR })

    expect(droidAutonomySurface(state, {}, true, { autonomyLevel: 'high' })?.level).toBe('low')
  })

  it('moves on from the accepted level when a later pick is accepted by a running chat', () => {
    const running = read('droid', { autonomyLevel: 'high', availableAutonomyLevels: FOUR })

    const after = commitStructuredAgentSessionPick(running, 'autonomyLevel', 'medium', {
      autonomyLevel: 'medium'
    })

    expect(droidAutonomySurface(after, {}, true, { autonomyLevel: 'high' })?.level).toBe('medium')
  })

  it('ignores a level Droid does not define, wherever it comes from', () => {
    const state = read('droid', { autonomyLevel: 'high' })

    expect(droidAutonomySurface(state, {}, true, { autonomyLevel: 'ultra' })?.level).toBe('high')
  })

  it('checks a pick against the levels offered once a held pick is counted', () => {
    const state = read('droid', { autonomyLevel: 'low', availableAutonomyLevels: ['off', 'low'] })

    expect(canSetDroidAutonomyOption(state, {}, 'off', { autonomyLevel: 'low' })).toBe(true)
    expect(canSetDroidAutonomyOption(state, {}, 'high', { autonomyLevel: 'low' })).toBe(false)
  })

  it('is Droid draft state with the Spec pair, and nothing else is', () => {
    expect(
      ['autonomyLevel', 'specModel', 'specEffort'].every((id) => isDroidDraftOptionId(id))
    ).toBe(true)
    expect(
      ['model', 'effort', 'planMode', 'fastMode', 'serviceTier'].some((id) =>
        isDroidDraftOptionId(id)
      )
    ).toBe(false)
  })
})

describe('an autonomy pick the host accepted', () => {
  it('shows the level the host kept when it lowered the one asked for', () => {
    const state = read('droid', { model: 'main', autonomyLevel: 'high' })

    const after = commitStructuredAgentSessionPick(state, 'autonomyLevel', 'high', {
      autonomyLevel: 'low'
    })

    expect(droidAutonomySurface(after, {}, true)?.level).toBe('low')
    expect(after.record).toBe(state.record)
  })

  it('shows the level asked for when the host names none', () => {
    const state = read('droid', { model: 'main', autonomyLevel: 'high' })

    const after = commitStructuredAgentSessionPick(state, 'autonomyLevel', 'medium', {
      model: 'main'
    })

    expect(droidAutonomySurface(after, {}, true)?.level).toBe('medium')
  })
})

describe('the autonomy control of another agent', () => {
  it.each(['claude', 'codex', 'pi'])('%s has none, because its answer names no level', (agent) => {
    const state = read(agent, { model: 'main' })

    expect(droidAutonomySurface(state, {}, true)).toBeNull()
    expect(structuredAgentSessionOptionSnapshot(state).map((row) => row.id)).not.toContain(
      'autonomyLevel'
    )
  })
})
