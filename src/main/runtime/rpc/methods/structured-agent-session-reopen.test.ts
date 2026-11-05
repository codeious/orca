import '../unused-default-rpc-methods.test-fixture'
import { afterEach, expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import { installChats } from '../../../ai-vault/structured-session-ownership.test-support'
import { call, clearStructuredHostStub } from './structured-agent-session-rpc.test-fixture'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'

afterEach(clearStructuredHostStub)
function owner(exited: boolean) {
  const record = agentSessionRecordFixture()
  record.provider = 'droid'
  record.providerHandleChain[0]!.handle = {
    transport: 'droid-stream-jsonrpc',
    agent: 'droid',
    nativeId: 'droid-original'
  }
  if (exited) {
    record.lease = {
      ...record.lease,
      claimStatus: 'released',
      ownerProcess: null,
      reservedSpawnToken: null,
      deathEvidence: { kind: 'exit-observed', observedAt: 3_000, detail: 'closed' }
    }
  }
  installChats([record])
  return record
}
const params = {
  worktree: 'id:workspace-1',
  agent: 'droid',
  resumeFrom: { providerSessionId: 'droid-original', closingPaneKeys: ['pane-1'] }
}

it('returns the stopped Droid owner instead of admitting a second chat', async () => {
  owner(true)
  const writers = vi.fn(async () => {})
  const result = await call('agentSession.createSupport', params, undefined, {
    assertStructuredAdoptionTerminalWritersExited: writers
  })
  expect(result).toMatchObject({
    ok: true,
    result: {
      supported: true,
      reopen: { sessionId: 'session-alpha-1', workspaceId: 'workspace-1' }
    }
  })
  expect(writers).toHaveBeenCalledExactlyOnceWith('droid', 'droid-original', ['pane-1'])
})

it('refuses an owner whose exit cannot be proven', async () => {
  owner(false)
  const result = await call('agentSession.createSupport', params, undefined, {
    assertStructuredAdoptionTerminalWritersExited: async () => {}
  })
  expect(result).toMatchObject({
    ok: false,
    error: { code: 'agent_session_ownership_unknown' }
  })
})

it('refuses reopen while another terminal may still write', async () => {
  owner(true)
  const result = await call('agentSession.createSupport', params, undefined, {
    assertStructuredAdoptionTerminalWritersExited: async () => {
      throw new Error('terminal writer still running')
    }
  })
  expect(result).toMatchObject({ ok: false })
  expect(result).not.toHaveProperty('result.reopen')
})

it('ensures the existing record under its saved account, checking terminals again before attach', async () => {
  const record = owner(true)
  const attach = vi.fn(async () => ({ ok: true, value: { sessionId: record.sessionId } }))
  const host = getStructuredAgentSessionHost()!
  Object.assign(host, { attach, sessionAgent: () => 'droid' })
  Object.assign(host.deps.store, { requireWritableRecord: () => record })
  const writers = vi.fn(async () => {
    expect(attach).not.toHaveBeenCalled()
  })
  const result = await call('agentSession.ensure', { sessionId: record.sessionId }, undefined, {
    assertStructuredAdoptionTerminalWritersExited: writers
  })
  expect(result).toMatchObject({
    ok: true,
    result: { ok: true, value: { sessionId: record.sessionId } }
  })
  expect(writers).toHaveBeenCalledExactlyOnceWith('droid', 'droid-original')
  expect(attach).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    expect.objectContaining({
      envelope: expect.objectContaining({ sessionId: record.sessionId }),
      accountHome: record.accountHome,
      location: record.location
    })
  )
  attach.mockClear()
  writers.mockRejectedValueOnce(new Error('terminal writer still running'))
  expect(
    await call('agentSession.ensure', { sessionId: record.sessionId }, undefined, {
      assertStructuredAdoptionTerminalWritersExited: writers
    })
  ).toMatchObject({ ok: false })
  expect(attach).not.toHaveBeenCalled()
})

it.each(['before', 'during'] as const)(
  'refuses ensure when the chat owner becomes unproven %s the terminal check',
  async (when) => {
    const record = owner(when !== 'before')
    const attach = vi.fn(async () => ({ ok: true }))
    const host = getStructuredAgentSessionHost()!
    Object.assign(host, { attach, sessionAgent: () => 'droid' })
    Object.assign(host.deps.store, { requireWritableRecord: () => record })
    const result = await call('agentSession.ensure', { sessionId: record.sessionId }, undefined, {
      assertStructuredAdoptionTerminalWritersExited: async () => {
        record.lease.deathEvidence = null
      }
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'agent_session_ownership_unknown' }
    })
    expect(attach).not.toHaveBeenCalled()
  }
)
