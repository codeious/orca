import { afterEach, beforeEach, expect, it } from 'vitest'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../shared/agent-session/agent-session-runtime-capabilities'
import { structuredAgentSessionCreateParams } from '../../shared/agent-session/structured-agent-session-create'
import {
  call,
  clearStructuredHostStub,
  installStructuredHostStub
} from '../runtime/rpc/methods/structured-sessions/protocol/structured-agent-session-rpc.test-fixture'

beforeEach(installStructuredHostStub)
afterEach(clearStructuredHostStub)

it('refuses a new Droid chat from a phone while the execution host has not opted in', async () => {
  const result = await call(
    'agentSession.create',
    structuredAgentSessionCreateParams({
      sessionId: 'experimental-session',
      worktree: 'id:workspace-1',
      agent: 'droid',
      randomUuid: () => '00000000-0000-0000-0000-0000000000fa',
      now: 1_700_000_000_000
    }),
    {
      clientId: 'phone-1',
      clientKind: 'mobile',
      clientCapabilities: [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY]
    }
  )
  expect(result).toMatchObject({
    ok: false,
    error: {
      data: {
        refusal: {
          code: 'structured_agent_session_unsupported',
          details: { reason: 'hostUnsupported' }
        }
      }
    }
  })
})
