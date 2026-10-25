import { describe, expect, it } from 'vitest'
import { isAgentSessionHandleProvider } from './agent-session-provider-handle'
import { isStructuredAdoptionAgent } from './structured-adoption-agent'

describe('isStructuredAdoptionAgent', () => {
  it.each(['claude', 'codex', 'droid'])('adopts %s', (agent) => {
    expect(isStructuredAdoptionAgent(agent)).toBe(true)
  })

  it.each(['gemini', 'opencode', 'pi', 'Droid', '', undefined, null, 7])(
    'does not adopt %j',
    (agent) => {
      expect(isStructuredAdoptionAgent(agent)).toBe(false)
    }
  )

  it('leaves the provider-handle guard on Claude and Codex', () => {
    expect(isAgentSessionHandleProvider('droid')).toBe(false)
  })
})
