import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session/lifecycle/agent-session-mutation-envelope'
import {
  DROID_AGENT,
  DROID_ACCOUNT_HOME_VARIABLE,
  DROID_HANDLE_TRANSPORT
} from '../../droid/droid-agent-definition'
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
    rig.heldStart(async ({ spawnToken, fence }) => ({
      acquisitionGeneration: `generation-${rig.adapter.acquire.mock.calls.length}`,
      process: { hostId: 'local', pid: 4242, processStartTimeMs: 1_700_000_000_000, spawnToken },
      link: {
        linkId: `link-${fence}`,
        handle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: 'provider-session' },
        origin: rig.store.getRecord(SESSION)?.providerHandleChain.length ? 'resumed' : 'created',
        mintedAtFence: fence,
        observedAt: rig.clock.now
      }
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

it('shows and changes the live Spec pair without changing the main pair at rest', async () => {
  for (const [key, value] of [
    ['model', 'main'],
    ['effort', 'low']
  ]) {
    const fields = { key, value }
    expect(
      await rig.host.setOption(CALLER, {
        ...fields,
        envelope: envelope('agentSession.setOption', fields)
      })
    ).toMatchObject({ ok: true })
  }
  expect((await rig.host.readOptions(SESSION)).current).toMatchObject({
    model: 'main',
    effort: 'low'
  })
  await send('main')
  await vi.waitFor(() =>
    expect(rig.host.collaboratorsForTests().sessions.get(SESSION)?.child?.phase).toBe('starting')
  )
  await rig.proveStart({
    sessionId: SESSION,
    fence: rig.store.getRecord(SESSION)!.lease.runtimeFence,
    acquisitionGeneration: 'generation-1'
  })
  await vi.waitFor(() => expect(rig.adapter.dispatch).toHaveBeenCalledOnce())
  for (const current of [
    { planMode: true, model: 'planner', effort: 'high' },
    { planMode: true, model: 'planner', effort: undefined },
    { planMode: false, model: 'main', effort: 'low' }
  ]) {
    rig.adapter.readOptions.mockResolvedValue({
      models: ['main', 'planner'].map((id) => ({
        id,
        label: id,
        isDefault: false,
        efforts: []
      })),
      current: { ...current, confirmed: ['model', ...(current.effort ? ['effort'] : [])] }
    })
    expect((await rig.host.readOptions(SESSION)).current).toMatchObject(current)
  }
  expect(rig.store.getRecord(SESSION)?.options).toMatchObject({ model: 'main', effort: 'low' })
  rig.adapter.readOptions.mockResolvedValue({
    models: [],
    current: { planMode: true, model: 'planner', effort: 'high' }
  })
  rig.host.deps.adapter.canSetOptionWhileIdle = () => true
  const written = vi.spyOn(rig.host.deps.adapter, 'setOption')
  for (const [key, value] of [
    ['model', 'next-planner'],
    ['effort', 'max']
  ]) {
    const fields = { key, value }
    expect(
      await rig.host.setOption(CALLER, {
        ...fields,
        envelope: envelope('agentSession.setOption', fields)
      })
    ).toMatchObject({ ok: true, value: fields })
    await rig.host.readOptions(SESSION)
  }
  expect(rig.store.getRecord(SESSION)?.options).toMatchObject({
    model: 'main',
    effort: 'low',
    specModel: 'next-planner',
    specEffort: 'max'
  })
  expect(written).toHaveBeenCalledWith(
    expect.objectContaining({ key: 'specModel', value: 'next-planner' })
  )
  expect(written).toHaveBeenCalledWith(expect.objectContaining({ key: 'specEffort', value: 'max' }))
})
