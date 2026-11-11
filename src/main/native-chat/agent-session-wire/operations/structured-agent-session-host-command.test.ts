import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../../shared/agent-session/lifecycle/agent-session-mutation-envelope'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../../shared/agent-session/journal/agent-session-journal-types'
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

function envelope(method: string, fields: Record<string, unknown>) {
  return {
    sessionId: SESSION,
    clientOperationId: hostTestOperationId(),
    expectedRuntimeFence: rig.store.requireWritableRecord(SESSION).lease.runtimeFence,
    payloadFingerprint: computeAgentSessionPayloadFingerprint({
      method,
      sessionId: SESSION,
      fields
    })
  }
}

describe('provider host commands', () => {
  it('replays the accepted reply without a second provider command or a model message', async () => {
    const run = vi
      .fn(async () => ({ text: 'Unexpected second execution' }))
      .mockResolvedValueOnce({ text: 'Context report' })
    rig.host.deps.adapter.readCommands = () => [
      { name: 'context', kind: 'command', hostCommand: true }
    ]
    rig.host.deps.adapter.hostCommand = run
    expect(await rig.host.attach(CALLER, hostTestAttachParams(null))).toMatchObject({ ok: true })
    const fields = { name: 'context', argument: '' }
    const params = { ...fields, envelope: envelope('agentSession.hostCommand', fields) }
    expect(await rig.host.hostCommand(CALLER, params)).toMatchObject({
      ok: true,
      value: { text: 'Context report' }
    })
    expect(await rig.host.hostCommand(CALLER, params)).toMatchObject({
      ok: true,
      replayed: true,
      value: { text: 'Context report' }
    })
    expect(rig.adapter.dispatch).not.toHaveBeenCalled()
  })

  it('refuses unreported commands and commands behind an unanswered prompt', async () => {
    const run = vi.fn(async () => ({ text: 'Must not run' }))
    rig.host.deps.adapter.readCommands = () => [
      { name: 'context', kind: 'command', hostCommand: true }
    ]
    rig.host.deps.adapter.hostCommand = run
    await rig.host.attach(CALLER, hostTestAttachParams(null))
    const unknown = { name: 'unknown', argument: '' }
    expect(
      await rig.host.hostCommand(CALLER, {
        ...unknown,
        envelope: envelope('agentSession.hostCommand', unknown)
      })
    ).toMatchObject({ ok: false, refusal: { code: 'agent_session_operation_invalid' } })
    const events = rig.adapter.acquire.mock.calls.at(-1)?.[0].events
    if (!events) {
      throw new Error('Approval requires an acquired session')
    }
    events.appendItem(
      { provider: 'codex', threadId: THREAD, turnId: 'turn-1', ordinal: 99 },
      {
        kind: 'approval',
        title: 'Run command?',
        detail: null,
        options: [{ id: 'allow', label: 'Allow' }],
        resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
      },
      { turnScope: AGENT_JOURNAL_THREAD_SCOPE }
    )
    await rig.host.flushStreamedEvents(SESSION)
    const fields = { name: 'context', argument: '' }
    expect(
      await rig.host.hostCommand(CALLER, {
        ...fields,
        envelope: envelope('agentSession.hostCommand', fields)
      })
    ).toMatchObject({ ok: false })
    expect(run).not.toHaveBeenCalled()
  })

  it('replays a conversation copy while preserving the source conversation', async () => {
    rig.host.deps.adapter.copyConversation = vi
      .fn(async () => ({ sessionId: 'unexpected-second-copy' }))
      .mockResolvedValueOnce({ sessionId: 'fork-session' })
    await rig.host.attach(CALLER, hostTestAttachParams(null))
    const params = { envelope: envelope('agentSession.copyConversation', {}) }
    expect(await rig.host.copyConversation(CALLER, params)).toMatchObject({
      ok: true,
      value: { providerSessionId: 'fork-session' }
    })
    expect(await rig.host.copyConversation(CALLER, params)).toMatchObject({
      ok: true,
      replayed: true,
      value: { providerSessionId: 'fork-session' }
    })
    expect(
      rig.store.requireWritableRecord(SESSION).providerHandleChain.at(-1)?.handle.nativeId
    ).toBe('019fd532-7c11-7a90-b6de-4e1a2c3d5f60')
  })
})
