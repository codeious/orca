import { expect, it } from 'vitest'
import {
  createRestTestRig,
  foundRestTestChat
} from '../host/testing/structured-agent-session-rest-test-rig'
import { HOST_TEST_SESSION } from '../host/testing/structured-agent-session-host-test-data'

it('persists confirmed provider picks and excludes keys the agent does not accept', async () => {
  const rig = await createRestTestRig({ idleSweep: { intervalMs: 60_000 } })
  try {
    await foundRestTestChat(rig)
    const acquisition = await rig.adapter.acquire.mock.results[0].value
    const fence = rig.store.getRecord(HOST_TEST_SESSION)!.lease.runtimeFence
    await rig.host.handleAdapterEvent({
      type: 'options-reported',
      sessionId: HOST_TEST_SESSION,
      fence,
      acquisitionGeneration: acquisition.acquisitionGeneration,
      reportedOptions: {},
      providerPicks: { model: 'selected-model', unknownOption: 'ignored' }
    })
    expect(rig.store.getRecord(HOST_TEST_SESSION)?.options).toEqual({
      model: 'selected-model'
    })
    await rig.host.close(HOST_TEST_SESSION, 'evict')
    await rig.restart()
    expect(rig.store.getRecord(HOST_TEST_SESSION)?.options).toEqual({
      model: 'selected-model'
    })
  } finally {
    await rig.host.close(HOST_TEST_SESSION, 'evict')
    await rig.dispose()
  }
})
