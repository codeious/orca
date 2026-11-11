import '../../../unused-default-rpc-methods.test-fixture'
import { afterEach, expect, it } from 'vitest'
import { agentSessionRecordFixture } from '../../../../../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import { installChats } from '../../../../../ai-vault/structured-session-ownership.test-support'
import {
  call,
  clearStructuredHostStub
} from '../protocol/structured-agent-session-rpc.test-fixture'

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
}

const params = {
  worktree: 'id:workspace-1',
  agent: 'droid',
  resumeFrom: { providerSessionId: 'droid-original', closingPaneKeys: ['pane-1'] }
}

it('returns the stopped owner instead of admitting a second chat', async () => {
  owner(true)
  const result = await call('agentSession.createSupport', params, undefined, {
    assertStructuredAdoptionTerminalWritersExited: async () => {}
  })
  expect(result).toMatchObject({
    ok: true,
    result: {
      supported: true,
      reopen: { sessionId: 'session-alpha-1', workspaceId: 'workspace-1' }
    }
  })
})
