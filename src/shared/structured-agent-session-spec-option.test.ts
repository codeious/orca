import { describe, expect, it } from 'vitest'
import {
  applyStructuredAgentSessionOptions,
  createStructuredAgentSessionOptionState
} from './agent-session/options/structured-agent-session-options'
import {
  canSetStructuredAgentSessionOption,
  structuredAgentSessionOptionSnapshot
} from './agent-session/options/structured-agent-session-option-snapshot'
import { structuredAgentSessionOptionStamp } from './agent-session/options/structured-agent-session-option-state'

describe('host-reported Spec mode', () => {
  const seed = { models: [], modelApply: {} }
  it.each(['droid', 'codex', 'pi'])(
    'offers nothing for %s until its host reports support',
    (agent) => {
      const state = createStructuredAgentSessionOptionState(agent, seed)
      expect(structuredAgentSessionOptionSnapshot(state).some((row) => row.id === 'planMode')).toBe(
        false
      )
      expect(canSetStructuredAgentSessionOption(state, 'planMode', true)).toBe(false)
    }
  )

  it('shows and sets a reported false without requiring a model, and follows later host answers', () => {
    let state = createStructuredAgentSessionOptionState('droid', seed)
    for (const planMode of [false, true, false]) {
      state = applyStructuredAgentSessionOptions(state, seed, { models: [], current: { planMode } })
      expect(
        structuredAgentSessionOptionSnapshot(state).find((row) => row.id === 'planMode')
      ).toMatchObject({
        label: 'Spec',
        settable: true,
        kind: { type: 'boolean', currentValue: planMode },
        valueSource: 'reported'
      })
      expect(canSetStructuredAgentSessionOption(state, 'planMode', !planMode)).toBe(true)
    }
    state = applyStructuredAgentSessionOptions(state, seed, { models: [], current: {} })
    expect(structuredAgentSessionOptionSnapshot(state).some((row) => row.id === 'planMode')).toBe(
      false
    )
  })

  it('changes the option stamp when another client changes Spec', () => {
    expect(structuredAgentSessionOptionStamp({ planMode: 'true' })).not.toEqual(
      structuredAgentSessionOptionStamp({ planMode: 'false' })
    )
  })
})
