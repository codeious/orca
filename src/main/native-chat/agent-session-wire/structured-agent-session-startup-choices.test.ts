import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session/lifecycle/agent-session-mutation-envelope'
import { DROID_AGENT, DROID_ACCOUNT_HOME_VARIABLE } from '../../droid/droid-agent-definition'
import { StructuredAgentRegistry } from './structured-agent-registry'
import { createTestParams, stopCreatedChat } from './structured-agent-session-create-test-fixture'
import {
  HOST_TEST_SESSION as SESSION,
  hostTestMessage,
  hostTestOperationId
} from './structured-agent-session-host-test-data'
import {
  createRestTestRig,
  REST_TEST_CALLER as CALLER,
  type RestTestRig
} from './structured-agent-session-rest-test-rig'

let rig: RestTestRig

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
  rig.adapter.acquire.mockImplementation(
    rig.heldStart(async ({ spawnToken }) => ({
      acquisitionGeneration: `generation-${rig.adapter.acquire.mock.calls.length}`,
      process: { hostId: 'local', pid: 4242, processStartTimeMs: 1_700_000_000_000, spawnToken }
    }))
  )
  expect(
    await rig.host.create(
      CALLER,
      createTestParams(undefined, {
        provider: 'droid',
        agent: 'droid',
        accountHome: { variable: DROID_ACCOUNT_HOME_VARIABLE, path: rig.root }
      })
    )
  ).toMatchObject({ ok: true })
  for (const [key, value] of [
    ['planMode', 'true'],
    ['autonomyLevel', 'high']
  ]) {
    const fields = { key, value }
    expect(
      await rig.host.setOption(CALLER, {
        ...fields,
        envelope: envelope('agentSession.setOption', fields)
      })
    ).toMatchObject({ ok: true })
  }
  expect(rig.adapter.acquire).not.toHaveBeenCalled()
})

afterEach(() => rig.dispose())

function envelope(method: string, fields: Record<string, unknown>) {
  return {
    sessionId: SESSION,
    clientOperationId: hostTestOperationId(),
    expectedRuntimeFence: rig.store.getRecord(SESSION)!.lease.runtimeFence,
    payloadFingerprint: computeAgentSessionPayloadFingerprint({
      method,
      sessionId: SESSION,
      fields
    })
  }
}

async function send(model: string) {
  const fields = { body: hostTestMessage('Make a plan'), selection: { model } }
  expect(
    await rig.host.send(CALLER, { ...fields, envelope: envelope('agentSession.send', fields) })
  ).toMatchObject({ ok: true })
}

it('keeps at-rest Spec and Permissions picks when the first message supplies its model', async () => {
  await send('message-model')
  await vi.waitFor(() => expect(rig.adapter.acquire).toHaveBeenCalledOnce())
  expect(rig.adapter.acquire.mock.calls[0]?.[0].options).toEqual({
    planMode: 'true',
    autonomyLevel: 'high',
    model: 'message-model'
  })
})

it('keeps Spec and Permissions when a message restarts the child after Stop', async () => {
  await send('first-model')
  await vi.waitFor(() =>
    expect(rig.host.collaboratorsForTests().sessions.get(SESSION)?.child?.phase).toBe('starting')
  )
  expect(await stopCreatedChat(rig.host)).toMatchObject({ ok: true })
  await send('next-model')
  await vi.waitFor(() => expect(rig.adapter.acquire).toHaveBeenCalledTimes(2))
  expect(rig.adapter.acquire.mock.calls[1]?.[0].options).toEqual({
    planMode: 'true',
    autonomyLevel: 'high',
    model: 'next-model'
  })
})
