// The one refusal whose message is written for a person: the agent explained why it would not take
// an option. Its sentence is quoted beside the generic words, for a change of option only, and
// never saved with the failure.

import { describe, expect, it } from 'vitest'
import { MAX_PROVIDER_DIAGNOSTIC_CHARS } from './agent-session-failure'
import { AGENT_SESSION_REFUSAL_REASONS } from './agent-session-refusal-details'
import {
  agentSessionRefusalNotice,
  agentSessionWriteNoticeEnglish,
  agentSessionWriteNoticeParts
} from './agent-session-refusal-notice'
import {
  agentSessionRefusalFailure,
  type AgentSessionWriteKind
} from './agent-session-write-failure'

const WRITES: AgentSessionWriteKind[] = [
  'read-history',
  'send',
  'composer-send',
  'stop',
  'stop-task',
  'stop-tasks',
  'answer',
  'option',
  'command',
  'clear',
  'compact',
  'goal'
]
const PROVIDER_TEXT =
  "Model not allowed by organization policy: This model is not available due to your organization's security settings."
const explained = (message = PROVIDER_TEXT) => ({
  code: 'agent_session_operation_invalid' as const,
  message,
  details: { reason: 'providerRefusedOption' as const }
})

describe('a refusal the provider explained', () => {
  it("quotes the provider's sentence between what was refused and that nothing changed", () => {
    const failure = agentSessionRefusalFailure(explained())

    expect(agentSessionWriteNoticeParts(failure, 'option', {}, PROVIDER_TEXT)).toEqual([
      'optionRejected',
      { text: PROVIDER_TEXT },
      'notDoneOption'
    ])
    expect(
      agentSessionWriteNoticeEnglish(
        agentSessionWriteNoticeParts(failure, 'option', {}, PROVIDER_TEXT)
      )
    ).toBe(`The agent didn't accept this setting. ${PROVIDER_TEXT} The setting wasn't changed.`)
  })

  it('ends a sentence that has no ending, so the next one does not run on', () => {
    const failure = agentSessionRefusalFailure(explained())

    expect(agentSessionWriteNoticeParts(failure, 'option', {}, ' Settings refused ')).toEqual([
      'optionRejected',
      { text: 'Settings refused.' },
      'notDoneOption'
    ])
  })

  it('keeps no more of a long sentence than a quoted provider diagnostic does', () => {
    const failure = agentSessionRefusalFailure(explained())
    const long = `${'a'.repeat(MAX_PROVIDER_DIAGNOSTIC_CHARS)} and then a great deal more`

    expect(agentSessionWriteNoticeParts(failure, 'option', {}, long)).toEqual([
      'optionRejected',
      { text: `${'a'.repeat(MAX_PROVIDER_DIAGNOSTIC_CHARS)}.` },
      'notDoneOption'
    ])
  })

  it('keeps the generic words where no sentence came with the refusal', () => {
    const failure = agentSessionRefusalFailure(explained())

    expect(agentSessionWriteNoticeParts(failure, 'option')).toEqual([
      'optionRejected',
      'notDoneOption'
    ])
    expect(agentSessionWriteNoticeParts(failure, 'option', {}, '  ')).toEqual([
      'optionRejected',
      'notDoneOption'
    ])
    expect(agentSessionRefusalNotice(explained(), 'option')).toBe(
      "The agent didn't accept this setting. The setting wasn't changed."
    )
  })

  it('is quoted for a change of option only', () => {
    const failure = agentSessionRefusalFailure(explained())

    for (const write of WRITES.filter((kind) => kind !== 'option')) {
      expect(agentSessionWriteNoticeParts(failure, write, {}, PROVIDER_TEXT), write).toEqual(
        agentSessionWriteNoticeParts(failure, write)
      )
    }
  })

  it('is quoted for no other reason, whatever sentence the caller holds', () => {
    const others = AGENT_SESSION_REFUSAL_REASONS.agent_session_operation_invalid.filter(
      (reason) => reason !== 'providerRefusedOption'
    )

    expect(others.length).toBeGreaterThan(0)
    for (const reason of others) {
      const failure = agentSessionRefusalFailure({
        code: 'agent_session_operation_invalid',
        details: { reason }
      })
      for (const write of WRITES) {
        expect(
          agentSessionWriteNoticeParts(failure, write, {}, PROVIDER_TEXT),
          `${reason} x ${write}`
        ).toEqual(agentSessionWriteNoticeParts(failure, write))
      }
    }
  })

  it('is kept as a reason only: what a saved refusal holds never carries the sentence', () => {
    const failure = agentSessionRefusalFailure(explained())

    expect(failure).toEqual({
      kind: 'refused',
      code: 'agent_session_operation_invalid',
      details: { reason: 'providerRefusedOption' }
    })
    expect(JSON.stringify(failure)).not.toContain('organization')
  })
})
