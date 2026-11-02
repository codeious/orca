import { afterEach, describe, expect, it } from 'vitest'
import {
  createQueuedMessageTestRig,
  QUEUED_RIG_CALLER,
  type QueuedMessageTestRig
} from './structured-agent-session-queued-message-rig.test-fixture'
import { hostTestMessage, hostTestOperationId } from './structured-agent-session-host-test-data'

let rig: QueuedMessageTestRig | undefined
afterEach(async () => {
  await rig?.dispose()
  rig = undefined
})

describe('after-reply sends', () => {
  it('holds and replays a send behind running work without sending provider queue placements', async () => {
    rig = await createQueuedMessageTestRig()
    await rig.workingSend()
    const calls = rig.dispatch.mock.calls.length
    const fields = { body: hostTestMessage('after the reply'), afterReply: true as const }
    const params = {
      envelope: rig.envelope(fields, 'agentSession.send', hostTestOperationId()),
      ...fields
    }
    expect(await rig.host.send(QUEUED_RIG_CALLER, params)).toMatchObject({
      ok: true,
      replayed: false,
      value: { queued: { state: 'waiting' } }
    })
    expect(await rig.host.send(QUEUED_RIG_CALLER, params)).toMatchObject({
      ok: true,
      replayed: true,
      value: { queued: { state: 'waiting' } }
    })
    expect(rig.dispatch).toHaveBeenCalledTimes(calls)
    expect(await rig.drafts()).toHaveLength(1)
    await rig.send('ordinary steer').result
    expect((await rig.host.journalSnapshot(params.envelope.sessionId)).submissions).toHaveLength(2)
  })

  it('starts an ordinary send when the host has no work to wait for', async () => {
    rig = await createQueuedMessageTestRig()
    const fields = { body: hostTestMessage('now'), afterReply: true as const }
    expect(
      await rig.host.send(QUEUED_RIG_CALLER, {
        envelope: rig.envelope(fields, 'agentSession.send', hostTestOperationId()),
        ...fields
      })
    ).toMatchObject({ ok: true, value: { submission: { dispatchState: 'pending' } } })
    expect(await rig.drafts()).toEqual([])
  })
})
