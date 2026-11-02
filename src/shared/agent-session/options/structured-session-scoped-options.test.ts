import { describe, expect, it } from 'vitest'
import type { SessionOptionDescriptor } from '../../native-chat/input/native-chat-session-options'
import {
  applyStructuredAgentSessionOptions,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionPicks
} from './structured-agent-session-options'
import {
  canSetStructuredAgentSessionOption,
  structuredAgentSessionOptionSnapshot
} from './structured-agent-session-option-snapshot'
import { structuredAgentSessionOptionView } from './structured-agent-session-option-view'

const seed = { models: [], modelApply: {} }
const option: SessionOptionDescriptor = {
  id: 'session-level',
  label: 'Level',
  scope: 'session',
  category: 'mode',
  kind: {
    type: 'select',
    currentValue: 'low',
    choices: [
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' }
    ]
  },
  valueSource: 'reported',
  transport: 'agent-session',
  settable: true
}
function state() {
  return applyStructuredAgentSessionOptions(
    createStructuredAgentSessionOptionState('droid', seed),
    seed,
    { models: [], current: {}, sessionOptions: [option] }
  )
}
describe('session-scoped option rows', () => {
  it('offers only host-listed values even without a named model', () => {
    const current = state()
    expect(structuredAgentSessionOptionSnapshot(current)).toContainEqual(option)
    expect(canSetStructuredAgentSessionOption(current, option.id, 'high')).toBe(true)
    expect(canSetStructuredAgentSessionOption(current, option.id, 'unlisted')).toBe(false)
    expect(canSetStructuredAgentSessionOption(current, option.id, 'high', undefined, false)).toBe(
      false
    )
  })
  it('keeps a session pick across main model changes without saving a launch default', () => {
    const held = structuredAgentSessionOptionView(state(), undefined, {
      model: 'other',
      [option.id]: 'high'
    })
    expect(structuredAgentSessionOptionSnapshot(held)).toContainEqual(
      expect.objectContaining({
        id: option.id,
        kind: expect.objectContaining({ currentValue: 'high' })
      })
    )
    expect(structuredAgentSessionOptionPicks(held, { [option.id]: 'high' })).toEqual([])
    const refreshed = applyStructuredAgentSessionOptions(held, seed, {
      models: [],
      current: {},
      sessionOptions: [option]
    })
    expect(structuredAgentSessionOptionSnapshot(refreshed)).toContainEqual(option)
  })
  it('removes session controls when the host stops reporting them', () => {
    const refreshed = applyStructuredAgentSessionOptions(state(), seed, { models: [], current: {} })
    expect(
      structuredAgentSessionOptionSnapshot(refreshed).some((row) => row.id === option.id)
    ).toBe(false)
    expect(canSetStructuredAgentSessionOption(refreshed, option.id, 'high')).toBe(false)
  })
})
