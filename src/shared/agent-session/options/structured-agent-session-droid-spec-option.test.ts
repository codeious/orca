import { expect, it } from 'vitest'
import {
  applyStructuredAgentSessionOptions,
  createStructuredAgentSessionOptionState
} from './structured-agent-session-options'
import {
  canSetStructuredAgentSessionOption,
  structuredAgentSessionOptionSnapshot
} from './structured-agent-session-option-snapshot'

it('follows host-reported plan mode without requiring a model', () => {
  const seed = { models: [], modelApply: {} }
  let state = createStructuredAgentSessionOptionState('droid', seed)
  state = applyStructuredAgentSessionOptions(state, seed, {
    models: [],
    current: { planMode: false }
  })
  expect(
    structuredAgentSessionOptionSnapshot(state).find((row) => row.id === 'planMode')?.kind
  ).toEqual({ type: 'boolean', currentValue: false })
  expect(canSetStructuredAgentSessionOption(state, 'planMode', true)).toBe(true)
  state = applyStructuredAgentSessionOptions(state, seed, {
    models: [],
    current: { planMode: true }
  })
  expect(
    structuredAgentSessionOptionSnapshot(state).find((row) => row.id === 'planMode')?.kind
  ).toEqual({ type: 'boolean', currentValue: true })
})
