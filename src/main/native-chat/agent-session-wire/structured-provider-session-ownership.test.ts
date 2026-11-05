import { expect, it } from 'vitest'
import { agentSessionConversationView } from '../../../shared/agent-session/lifecycle/agent-session-conversation-view'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import {
  listStructuredProviderSessionOwnership,
  terminalResumeBlocked
} from './structured-provider-session-ownership'

it('allows only Droid to resume after a proven release, never while live or unverifiable', () => {
  const record = agentSessionRecordFixture()
  record.provider = 'droid'
  record.providerHandleChain[0]!.handle = {
    agent: 'droid',
    transport: 'droid-stream-jsonrpc',
    nativeId: '019fd532-7c11-7a90-b6de-4e1a2c3d5f60'
  }
  const blocked = () =>
    terminalResumeBlocked(
      listStructuredProviderSessionOwnership([agentSessionConversationView(record)])[0]!
    )
  expect(blocked()).toBe(true)
  record.lease = agentSessionLeaseFixture({
    claimStatus: 'released',
    ownerProcess: null,
    reservedSpawnToken: null
  })
  expect(blocked()).toBe(true)
  record.lease.deathEvidence = { kind: 'exit-observed', detail: 'child exited', observedAt: 3_000 }
  expect(blocked()).toBe(false)
  record.provider = 'claude'
  record.providerHandleChain[0]!.handle = {
    agent: 'claude',
    transport: 'claude-sdk',
    nativeId: 'other'
  }
  expect(blocked()).toBe(true)
})
