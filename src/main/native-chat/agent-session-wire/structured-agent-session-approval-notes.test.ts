// A note beside an approval's chosen option reaches the provider only from a card that says it takes one.

import { describe, expect, it } from 'vitest'
import { agentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../shared/agent-session-journal-types'
import {
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD
} from './structured-agent-session-host-test-data'
import {
  attach,
  CALLER,
  envelope,
  hostTestState
} from './structured-agent-session-host-test-harness'

let ordinal = 200

type CardFlags = { acceptsComment?: true; acceptsPlanEdit?: true }

async function seedPlanApproval(flags: CardFlags): Promise<{ itemId: string; revision: number }> {
  const { host, acquire } = hostTestState()
  const identity = {
    provider: 'codex' as const,
    threadId: THREAD,
    turnId: 'turn-1',
    ordinal: (ordinal += 1)
  }
  const events = acquire.mock.calls.at(-1)?.[0].events
  if (!events) {
    throw new Error('requires an acquired session')
  }
  events.appendItem(
    identity,
    {
      kind: 'approval',
      title: 'Review proposed plan',
      detail: null,
      subject: { kind: 'plan', text: '1. Write the file.' },
      ...flags,
      options: [
        { id: 'proceed_once', label: 'Proceed' },
        { id: 'cancel', label: 'Keep planning' }
      ],
      resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
    },
    { turnScope: AGENT_JOURNAL_THREAD_SCOPE }
  )
  await host.flushStreamedEvents(SESSION)
  const itemId = agentJournalItemKey(identity)
  const page = await host.history({ sessionId: SESSION, direction: 'tail' })
  const appended = page.ok ? page.page.items.find((item) => item.itemId === itemId) : null
  if (!appended) {
    throw new Error('provider approval was not written to the journal')
  }
  return { itemId, revision: appended.revision }
}

async function respond(
  prompt: { itemId: string; revision: number },
  notes: { comment?: string; editedSpecContent?: string }
): ReturnType<ReturnType<typeof hostTestState>['host']['respondToPrompt']> {
  const fields = {
    itemId: prompt.itemId,
    expectedRevision: prompt.revision,
    optionId: 'proceed_once',
    ...notes
  }
  return hostTestState().host.respondToPrompt(CALLER, {
    envelope: envelope('agentSession.respondTo:approval', fields),
    kind: 'approval',
    ...fields
  })
}

describe('a note beside an approval answer', () => {
  it('reaches the provider with the chosen option when the card takes it', async () => {
    await attach()
    const prompt = await seedPlanApproval({ acceptsComment: true, acceptsPlanEdit: true })

    const result = await respond(prompt, {
      comment: 'Also add a test.',
      editedSpecContent: '1. Write the file.\n2. Add a test.'
    })

    expect(result).toMatchObject({
      ok: true,
      value: { resolution: { state: 'resolved', selectedOptionId: 'proceed_once' } }
    })
    expect(hostTestState().answerPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: prompt.itemId,
        response: {
          kind: 'option',
          optionId: 'proceed_once',
          comment: 'Also add a test.',
          editedSpecContent: '1. Write the file.\n2. Add a test.'
        }
      })
    )
  })

  it('leaves a field the card did not get out of the response', async () => {
    await attach()
    const prompt = await seedPlanApproval({ acceptsComment: true })

    await respond(prompt, { comment: 'Looks right.' })

    expect(hostTestState().answerPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        response: { kind: 'option', optionId: 'proceed_once', comment: 'Looks right.' }
      })
    )
  })

  it('is refused, without reaching the provider, by a card that takes no comment', async () => {
    await attach()
    const prompt = await seedPlanApproval({ acceptsPlanEdit: true })

    const result = await respond(prompt, { comment: 'Looks right.' })

    expect(result).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_invalid' }
    })
    expect(hostTestState().answerPrompt).not.toHaveBeenCalled()
  })

  it('is refused by a card that takes no edited plan', async () => {
    await attach()
    const prompt = await seedPlanApproval({ acceptsComment: true })

    const result = await respond(prompt, { editedSpecContent: '1. Something else.' })

    expect(result).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_invalid' }
    })
    expect(hostTestState().answerPrompt).not.toHaveBeenCalled()
  })

  it('is refused by an approval from a provider that never set either flag', async () => {
    await attach()
    const prompt = await seedPlanApproval({})

    const result = await respond(prompt, { comment: 'Looks right.' })

    expect(result).toMatchObject({ ok: false })
    expect(hostTestState().answerPrompt).not.toHaveBeenCalled()
  })
})
