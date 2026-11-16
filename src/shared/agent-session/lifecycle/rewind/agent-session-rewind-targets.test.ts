import { expect, it } from 'vitest'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../journal/agent-session-journal-types'
import { agentSessionRewindTargetIds } from './agent-session-rewind-targets'

function acceptedSend(clientMessageId: string, providerItemId: string, sequence: number) {
  const submission: AgentJournalSubmission = {
    clientMessageId,
    fence: 1,
    payloadFingerprint: `fp-${clientMessageId}`,
    dispatchState: 'accepted',
    providerItemId,
    reason: null,
    submittedAt: sequence,
    resolvedAt: sequence
  }
  const item: AgentJournalRenderItem = {
    itemId: `orca:${clientMessageId}`,
    revision: 1,
    body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: clientMessageId }] },
    sequence,
    observedAt: sequence
  }
  return { submission, item }
}

it('offers a sent message under a legacy key only when its agent names its messages that way', () => {
  const sends = [
    acceptedSend('droid', 'legacy:droid:session:message', 1),
    acceptedSend('codex', 'legacy:codex:session:record', 2),
    acceptedSend('claude', 'legacy:claude:session:record', 3)
  ]
  const targets = agentSessionRewindTargetIds(
    {
      items: sends.map(({ item }) => item),
      submissions: sends.map(({ submission }) => submission)
    },
    0
  )
  expect([...targets]).toEqual(['orca:droid'])
})
