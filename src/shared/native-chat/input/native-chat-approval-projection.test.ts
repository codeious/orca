import { expect, it } from 'vitest'
import type { AgentJournalApprovalItem } from '../../agent-session/journal/agent-session-journal-types'
import { chatApprovalFromJournal } from './native-chat-interactive-prompt'

it('offers only the note fields accepted by both the card and the host', () => {
  const body: AgentJournalApprovalItem = {
    kind: 'approval',
    title: 'Review plan',
    detail: null,
    acceptsComment: true,
    acceptsPlanEdit: true,
    options: [{ id: 'proceed', label: 'Proceed' }],
    resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
  }
  expect(chatApprovalFromJournal(body, true)).toMatchObject({
    acceptsComment: true,
    acceptsPlanEdit: true
  })
  const olderHost = chatApprovalFromJournal(body, false)
  expect(olderHost).not.toHaveProperty('acceptsComment')
  expect(olderHost).not.toHaveProperty('acceptsPlanEdit')
  const plain = chatApprovalFromJournal(
    { ...body, acceptsComment: undefined, acceptsPlanEdit: undefined },
    true
  )
  expect(plain).not.toHaveProperty('acceptsComment')
  expect(plain).not.toHaveProperty('acceptsPlanEdit')
})
