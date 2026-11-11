import '../../../unused-default-rpc-methods.test-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_SESSION_MCP_SIGN_IN_OPEN_CLIENT_CAPABILITY } from '../../../../../../shared/agent-session/agent-session-mcp-sign-in-capability'
import { AGENT_SESSION_HOST_COMMAND_CAPABILITY } from '../../../../../../shared/agent-session/agent-session-host-command'
import {
  call,
  clearStructuredHostStub,
  hostCalls,
  installStructuredHostStub,
  openStream
} from '../protocol/structured-agent-session-rpc.test-fixture'
import {
  envelope,
  SESSION,
  STRUCTURED_CLIENT
} from '../protocol/structured-agent-session-rpc-client.test-fixture'

const DESKTOP = {
  ...STRUCTURED_CLIENT,
  connectionId: 'connection',
  pairedDeviceId: 'desktop',
  clientCapabilities: [
    ...STRUCTURED_CLIENT.clientCapabilities,
    AGENT_SESSION_HOST_COMMAND_CAPABILITY,
    AGENT_SESSION_MCP_SIGN_IN_OPEN_CLIENT_CAPABILITY
  ]
}
const COMMAND = { name: 'mcp', argument: 'sign-in sample', envelope: envelope() }
const acknowledge = vi.fn(() => true)
beforeEach(() => {
  installStructuredHostStub()
  hostCalls.hostCommand = vi.fn(async () => ({ text: 'sample: signed-in' }))
  acknowledge.mockReset().mockReturnValue(true)
  Reflect.set(hostCalls, 'mcpSignIn', { acknowledge })
})
afterEach(clearStructuredHostStub)

describe('sign-in RPC authority', () => {
  it('uses the same transport-proven identity for subscription, hostCommand and acknowledgment', async () => {
    await openStream('agentSession.subscribe', { sessionId: SESSION }, DESKTOP)
    await call('agentSession.hostCommand', COMMAND, DESKTOP)
    expect(hostCalls.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpSignInCaller: { callerKey: 'desktop', connectionId: 'connection' }
      })
    )
    expect(hostCalls.hostCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpSignInCaller: { callerKey: 'desktop', connectionId: 'connection' },
        localMcpSignIn: false
      }),
      COMMAND
    )
    expect(
      await call(
        'agentSession.mcpSignInOpened',
        { sessionId: SESSION, requestId: 'open', opened: true },
        DESKTOP
      )
    ).toMatchObject({ ok: true, result: { accepted: true } })
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith(
      SESSION,
      'open',
      'connection',
      'desktop',
      true
    )
  })

  it('rejects forged authority before reaching the host', async () => {
    expect(
      await call(
        'agentSession.mcpSignInOpened',
        {
          sessionId: SESSION,
          requestId: 'open',
          opened: true,
          callerKey: 'forged'
        },
        DESKTOP
      )
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
    expect(acknowledge).not.toHaveBeenCalled()
  })
})
