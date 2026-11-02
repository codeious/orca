import '../unused-default-rpc-methods.test-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_SESSION_MCP_SIGN_IN_OPEN_CLIENT_CAPABILITY } from '../../../../shared/agent-session-mcp-sign-in-capability'
import { AGENT_SESSION_HOST_COMMAND_CAPABILITY } from '../../../../shared/agent-session/agent-session-host-command'
import {
  call,
  clearStructuredHostStub,
  hostCalls,
  installStructuredHostStub,
  openStream,
  SESSION,
  STRUCTURED_CLIENT,
  envelope
} from './structured-agent-session-rpc.test-fixture'

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

  it.each([
    { ...DESKTOP, clientCapabilities: STRUCTURED_CLIENT.clientCapabilities },
    { ...DESKTOP, clientKind: 'mobile' as const },
    { ...DESKTOP, connectionId: undefined }
  ])(
    'withholds transient requests and acknowledgments without a capable desktop connection',
    async (client) => {
      await openStream('agentSession.subscribe', { sessionId: SESSION }, client)
      expect(hostCalls.subscribe.mock.calls[0]?.[0].mcpSignInCaller).toBeUndefined()
      expect(
        await call(
          'agentSession.mcpSignInOpened',
          { sessionId: SESSION, requestId: 'open', opened: true },
          client
        )
      ).toMatchObject({ ok: true, result: { accepted: false } })
      expect(acknowledge).not.toHaveBeenCalled()
    }
  )

  it.each([
    { sessionId: SESSION, requestId: 'open', opened: true, callerKey: 'forged' },
    { sessionId: SESSION, requestId: 'open', opened: true, connectionId: 'forged' },
    { sessionId: SESSION, requestId: '', opened: true },
    { sessionId: SESSION, requestId: 'open', opened: 'yes' }
  ])('rejects malformed or forged authority before reaching the host', async (params) => {
    expect(await call('agentSession.mcpSignInOpened', params, DESKTOP)).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
    expect(acknowledge).not.toHaveBeenCalled()
  })
})
