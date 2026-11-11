import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentJournalItemKey } from '../../../../shared/agent-session/journal/agent-session-journal-item-key'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import { computeAgentSessionPayloadFingerprint } from '../../../../shared/agent-session/lifecycle/agent-session-mutation-envelope'
import {
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD,
  hostTestAttachParams,
  hostTestOperationId
} from '../host/testing/structured-agent-session-host-test-data'
import {
  createRestTestRig,
  REST_TEST_CALLER as CALLER,
  type RestTestRig
} from '../host/testing/structured-agent-session-rest-test-rig'

let rig: RestTestRig

beforeEach(async () => {
  rig = await createRestTestRig({ idleSweep: { intervalMs: 3_600_000 } })
})

afterEach(async () => rig.dispose())

async function approval(acceptsComment: boolean) {
  await rig.host.attach(CALLER, hostTestAttachParams(null))
  const identity = { provider: 'codex' as const, threadId: THREAD, turnId: 'turn-1', ordinal: 200 }
  const events = rig.adapter.acquire.mock.calls.at(-1)?.[0].events
  if (!events) {
    throw new Error('Approval requires an acquired session')
  }
  events.appendItem(
    identity,
    {
      kind: 'approval',
      title: 'Review plan',
      detail: null,
      acceptsComment,
      acceptsPlanEdit: true,
      options: [{ id: 'proceed', label: 'Proceed' }],
      resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
    },
    { turnScope: AGENT_JOURNAL_THREAD_SCOPE }
  )
  await rig.host.flushStreamedEvents(SESSION)
  const fields = {
    itemId: agentJournalItemKey(identity),
    expectedRevision: 1,
    optionId: 'proceed',
    comment: 'Also add a test.',
    editedSpecContent: '1. Write the file.\n2. Add a test.'
  }
  return {
    kind: 'approval' as const,
    ...fields,
    envelope: {
      sessionId: SESSION,
      clientOperationId: hostTestOperationId(),
      expectedRuntimeFence: rig.store.requireWritableRecord(SESSION).lease.runtimeFence,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.respondTo:approval',
        sessionId: SESSION,
        fields
      })
    }
  }
}

describe('approval notes', () => {
  it('delivers the exact notes with the chosen option when the card accepts them', async () => {
    const answer = vi.fn(rig.host.deps.adapter.answerPrompt)
    rig.host.deps.adapter.answerPrompt = answer
    expect(await rig.host.respondToPrompt(CALLER, await approval(true))).toMatchObject({
      ok: true,
      value: { resolution: { state: 'resolved', selectedOptionId: 'proceed' } }
    })
    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({
        response: {
          kind: 'option',
          optionId: 'proceed',
          comment: 'Also add a test.',
          editedSpecContent: '1. Write the file.\n2. Add a test.'
        }
      })
    )
  })

  it('refuses a comment the card does not accept without reaching the provider', async () => {
    const answer = vi.fn(rig.host.deps.adapter.answerPrompt)
    rig.host.deps.adapter.answerPrompt = answer
    expect(await rig.host.respondToPrompt(CALLER, await approval(false))).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_invalid' }
    })
    expect(answer).not.toHaveBeenCalled()
  })
})
