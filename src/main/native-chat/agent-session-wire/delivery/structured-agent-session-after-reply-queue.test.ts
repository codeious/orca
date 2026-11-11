import { afterEach, expect, it } from 'vitest'
import {
  createQueuedMessageTestRig,
  QUEUED_RIG_CALLER,
  type QueuedMessageTestRig
} from '../host/testing/structured-agent-session-queued-message-rig.test-fixture'
import {
  hostTestMessage,
  hostTestOperationId
} from '../host/testing/structured-agent-session-host-test-data'

let rig: QueuedMessageTestRig | undefined
afterEach(async () => {
  await rig?.dispose()
  rig = undefined
})

it('holds and replays an after-reply send behind running work', async () => {
  rig = await createQueuedMessageTestRig()
  await rig.workingSend()
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
})
