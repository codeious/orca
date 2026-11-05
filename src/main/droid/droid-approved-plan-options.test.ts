import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRestTestRig,
  REST_TEST_CALLER,
  restTestSend,
  type RestTestRig
} from '../native-chat/agent-session-wire/structured-agent-session-rest-test-rig'
import { createTestParams } from '../native-chat/agent-session-wire/structured-agent-session-create-test-fixture'
import { HOST_TEST_SESSION as SESSION } from '../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import { StructuredAgentRegistry } from '../native-chat/agent-session-wire/structured-agent-registry'
import {
  DROID_ACCOUNT_HOME_VARIABLE,
  DROID_AGENT,
  DROID_HANDLE_TRANSPORT
} from './droid-agent-definition'

let rig: RestTestRig
const saved = {
  model: 'normal-model',
  effort: 'high',
  specModel: 'spec-model',
  specEffort: 'low',
  planMode: 'true'
}

beforeEach(async () => {
  rig = await createRestTestRig({ idleSweep: { intervalMs: 60_000 } })
  await rig.restart({
    agents: new StructuredAgentRegistry([
      {
        definition: {
          ...DROID_AGENT,
          capabilities: { ...DROID_AGENT.capabilities, rewind: false, compact: false }
        },
        adapter: {
          ...rig.adapter,
          cancelTurn: async () => ({ cancelled: true }),
          setOption: async () => undefined,
          answerPrompt: async () => undefined
        }
      }
    ])
  })
  rig.adapter.acquire.mockImplementation(async ({ identity, fence, spawnToken }) => ({
    acquisitionGeneration: `droid-${fence}`,
    process: { hostId: 'local', pid: 4242, processStartTimeMs: 1_700_000_000_000, spawnToken },
    link: {
      linkId: `droid-link-${fence}`,
      handle: identity.providerHandle ?? {
        transport: DROID_HANDLE_TRANSPORT,
        agent: 'droid',
        nativeId: 'approved-plan'
      },
      origin: identity.providerHandle ? 'resumed' : 'created',
      mintedAtFence: fence,
      observedAt: rig.clock.now
    }
  }))
  rig.adapter.dispatch.mockResolvedValue({ state: 'admitted' })
  expect(
    await rig.host.create(
      REST_TEST_CALLER,
      createTestParams(undefined, {
        provider: 'droid',
        agent: 'droid',
        accountHome: { variable: DROID_ACCOUNT_HOME_VARIABLE, path: rig.root },
        options: saved
      })
    )
  ).toMatchObject({ ok: true })
  expect(await rig.host.send(REST_TEST_CALLER, restTestSend('Plan this.'))).toMatchObject({
    ok: true
  })
  await vi.waitFor(() => expect(rig.adapter.dispatch).toHaveBeenCalled())
})

afterEach(async () => {
  await rig.host.close(SESSION, 'evict')
  await rig.dispose()
})

describe('Droid approved plan options', () => {
  it.each([undefined, 'medium'])(
    'saves the approval level %s before publishing status and resumes with Normal options',
    async (level) => {
      const permissions: Record<string, string> = level ? { autonomyLevel: level } : {}
      const fence = rig.store.getRecord(SESSION)!.lease.runtimeFence
      expect(rig.host.readStatusSummary(SESSION)?.planMode).toBe('true')
      await rig.host.handleAdapterEvent({
        type: 'options-reported',
        sessionId: SESSION,
        fence,
        acquisitionGeneration: `droid-${fence}`,
        reportedOptions: { planMode: false },
        providerPicks: { planMode: 'false', ...permissions, unknownOption: 'ignored' }
      })
      expect(rig.store.getRecord(SESSION)?.options).toEqual({
        ...saved,
        planMode: 'false',
        ...permissions
      })
      expect(rig.host.readStatusSummary(SESSION)?.planMode).toBe('false')
      await rig.host.close(SESSION, 'evict')
      expect(await rig.host.send(REST_TEST_CALLER, restTestSend('Continue.'))).toMatchObject({
        ok: true
      })
      await vi.waitFor(() => expect(rig.adapter.acquire).toHaveBeenCalledTimes(2))
      expect(rig.adapter.acquire.mock.lastCall?.[0].options).toEqual({
        ...saved,
        planMode: 'false',
        ...permissions
      })
    }
  )
})
