import { describe, expect, it } from 'vitest'
import { agentJournalItemKey, agentJournalSubmissionKey } from './agent-session-journal-item-key'
import { droidMessageIdOfJournalItem } from './droid-rewind-message-id'

const droidKey = (messageId: string) => agentJournalItemKey({ provider: 'droid', messageId })
const legacyKey = (agent: 'droid' | 'codex', recordId: string) =>
  agentJournalItemKey({ provider: 'legacy', agent, sessionId: 'adopted-1', recordId })

describe('the Droid message a journal row is', () => {
  it('is the message id of a row Droid echoed for a send', () => {
    expect(droidMessageIdOfJournalItem(droidKey('msg-1'), [])).toBe('msg-1')
  })

  it('follows a send Orca placed to the row Droid accepted it as', () => {
    const submissions = [
      {
        clientMessageId: 'client-1',
        dispatchState: 'accepted' as const,
        providerItemId: droidKey('msg-2')
      }
    ]

    expect(droidMessageIdOfJournalItem(agentJournalSubmissionKey('client-1'), submissions)).toBe(
      'msg-2'
    )
  })

  it('is nothing for a send Droid has not accepted, which has no message to go back to', () => {
    const submissions = [
      { clientMessageId: 'client-1', dispatchState: 'pending' as const, providerItemId: null }
    ]

    expect(
      droidMessageIdOfJournalItem(agentJournalSubmissionKey('client-1'), submissions)
    ).toBeNull()
  })

  it('is the record id of a row adopted from a Droid transcript', () => {
    expect(droidMessageIdOfJournalItem(legacyKey('droid', 'msg-3'), [])).toBe('msg-3')
  })

  it('is nothing for an adopted row known only by its line, which Droid never named', () => {
    expect(droidMessageIdOfJournalItem(legacyKey('droid', '#12'), [])).toBeNull()
  })

  it('is nothing for another agent’s rows, whatever their ids look like', () => {
    expect(droidMessageIdOfJournalItem(legacyKey('codex', 'msg-4'), [])).toBeNull()
    expect(
      droidMessageIdOfJournalItem(
        agentJournalItemKey({ provider: 'claude', sessionId: 's', uuid: 'u' }),
        []
      )
    ).toBeNull()
    expect(droidMessageIdOfJournalItem('not a journal key', [])).toBeNull()
  })
})
