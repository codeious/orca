// A send that asks to wait for the running reply (Droid's Ctrl+Enter): the request survives from
// acceptance to the handover, and reaches the adapter only when the client asked.

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { StructuredAgentSessionHost } from './structured-agent-session-host'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import {
  attach,
  CALLER,
  envelope,
  hostTestState
} from './structured-agent-session-host-test-harness'
import {
  HOST_TEST_SESSION as SESSION,
  hostTestMessage
} from './structured-agent-session-host-test-data'
import { agentSessionSendBodyFingerprint } from '../../../shared/structured-agent-session-send-mutation'

let host: StructuredAgentSessionHost
let dispatch: Mock<StructuredAgentSessionAdapter['dispatch']>

beforeEach(() => {
  ;({ host, dispatch } = hostTestState())
})

async function submissionOf(clientMessageId: string) {
  return (await host.journalSnapshot(SESSION)).submissions.find(
    (entry) => entry.clientMessageId === clientMessageId
  )
}

async function handedOver(clientMessageId: string): Promise<void> {
  await vi.waitFor(async () => {
    expect((await submissionOf(clientMessageId))?.handedOverAt).toBeDefined()
  })
}

describe('send afterReply', () => {
  it('hands the adapter afterReply when the send asked to wait, and nothing when it did not', async () => {
    await attach()
    const waitBody = hostTestMessage('then answer this')
    const wait = {
      envelope: envelope('agentSession.send', { body: waitBody, afterReply: true }),
      body: waitBody,
      afterReply: true as const
    }
    expect(await host.send(CALLER, wait)).toMatchObject({ ok: true })
    await handedOver(wait.envelope.clientOperationId)

    const plainBody = hostTestMessage('steer this')
    const plain = { envelope: envelope('agentSession.send', { body: plainBody }), body: plainBody }
    expect(await host.send(CALLER, plain)).toMatchObject({ ok: true })
    await handedOver(plain.envelope.clientOperationId)

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      clientMessageId: wait.envelope.clientOperationId,
      afterReply: true
    })
    expect(dispatch.mock.calls[1]?.[0]).not.toHaveProperty('afterReply')
  })

  it('records the request on the submission so a handover after a restart still waits', async () => {
    await attach()
    const body = hostTestMessage('then answer this')
    const params = {
      envelope: envelope('agentSession.send', { body, afterReply: true }),
      body,
      afterReply: true as const
    }
    await host.send(CALLER, params)
    expect(await submissionOf(params.envelope.clientOperationId)).toMatchObject({
      afterReply: true
    })
  })

  it('counts the request in the operation fingerprint, never the message fingerprint', async () => {
    await attach()
    const body = hostTestMessage('then answer this')
    // Fingerprinted without the request: the host refuses a send that adds it.
    const mismatched = {
      envelope: envelope('agentSession.send', { body }),
      body,
      afterReply: true as const
    }
    const refused = await host.send(CALLER, mismatched)
    expect(refused.ok).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()

    const waitBody = hostTestMessage('another')
    const wait = {
      envelope: envelope('agentSession.send', { body: waitBody, afterReply: true }),
      body: waitBody,
      afterReply: true as const
    }
    await host.send(CALLER, wait)
    const row = await submissionOf(wait.envelope.clientOperationId)
    // The echo aliasing recomputes the body-only fingerprint, so it must not move with the request.
    expect(row?.payloadFingerprint).toBe(agentSessionSendBodyFingerprint(SESSION, waitBody))
  })
})
