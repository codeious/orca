import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_SESSION_MCP_SIGN_IN_OPEN_CLIENT_CAPABILITY } from '../../../../shared/agent-session-mcp-sign-in-capability'
import {
  call,
  clearStructuredHostStub,
  hostCalls,
  installStructuredHostStub,
  openStream,
  SESSION,
  STRUCTURED_CLIENT
} from './structured-agent-session-rpc.test-fixture'

const DESKTOP = {
  ...STRUCTURED_CLIENT,
  connectionId: 'desktop-connection',
  clientId: 'private-bearer',
  pairedDeviceId: 'desktop-device',
  clientCapabilities: [
    ...STRUCTURED_CLIENT.clientCapabilities,
    AGENT_SESSION_MCP_SIGN_IN_OPEN_CLIENT_CAPABILITY
  ]
}
const COMMAND = { name: 'mcp', action: { kind: 'sign-in', serverName: 'docs' } } as const
const acknowledge = vi.fn(() => true)

beforeEach(() => {
  installStructuredHostStub()
  hostCalls.droidCommand = vi.fn(async () => ({ name: 'mcp' }))
  acknowledge.mockReset().mockReturnValue(true)
  Reflect.set(hostCalls, 'mcpSignIn', { acknowledge })
})

afterEach(clearStructuredHostStub)

describe('MCP sign-in RPC caller binding', () => {
  it('binds a capable desktop subscription and command to the same proven identity', async () => {
    await openStream('agentSession.subscribe', { sessionId: SESSION }, DESKTOP)
    await call('agentSession.droidCommand', { sessionId: SESSION, command: COMMAND }, DESKTOP)

    const caller = { connectionId: 'desktop-connection', callerKey: 'desktop-device' }
    expect(hostCalls.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION, mcpSignInCaller: caller })
    )
    expect(hostCalls.droidCommand).toHaveBeenCalledWith(SESSION, COMMAND, caller)
  })

  it('acknowledges only with the connection and proven caller supplied by the transport', async () => {
    const response = await call(
      'agentSession.mcpSignInOpened',
      { sessionId: SESSION, requestId: 'open-request', opened: true },
      DESKTOP
    )

    expect(response).toMatchObject({ ok: true, result: { accepted: true } })
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith(
      SESSION,
      'open-request',
      'desktop-connection',
      'desktop-device',
      true
    )
  })

  it.each([
    ['a legacy desktop', { ...DESKTOP, clientCapabilities: STRUCTURED_CLIENT.clientCapabilities }],
    ['a mobile client claiming desktop support', { ...DESKTOP, clientKind: 'mobile' as const }],
    ['a client without a connection identity', { ...DESKTOP, connectionId: undefined }],
    ['an in-process caller without negotiation', undefined]
  ])('never registers an opener or accepts an acknowledgment from %s', async (_label, client) => {
    await openStream('agentSession.subscribe', { sessionId: SESSION }, client)
    await call('agentSession.droidCommand', { sessionId: SESSION, command: COMMAND }, client)
    const response = await call(
      'agentSession.mcpSignInOpened',
      { sessionId: SESSION, requestId: 'open-request', opened: true },
      client
    )

    expect(hostCalls.subscribe.mock.calls[0]?.[0]).not.toHaveProperty('mcpSignInCaller')
    expect(hostCalls.droidCommand).toHaveBeenCalledWith(SESSION, COMMAND, undefined)
    expect(response).toMatchObject({ ok: true, result: { accepted: false } })
    expect(acknowledge).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'forwards opened=%s and returns the host acceptance decision',
    async (opened) => {
      acknowledge.mockReturnValueOnce(false)
      const response = await call(
        'agentSession.mcpSignInOpened',
        { sessionId: SESSION, requestId: 'expired-request', opened },
        DESKTOP
      )

      expect(response).toMatchObject({ ok: true, result: { accepted: false } })
      expect(acknowledge).toHaveBeenCalledExactlyOnceWith(
        SESSION,
        'expired-request',
        'desktop-connection',
        'desktop-device',
        opened
      )
    }
  )

  it('uses the same fallback caller key when the desktop is not a paired device', async () => {
    const client = { ...DESKTOP, pairedDeviceId: undefined, clientId: ' desktop-client ' }
    await openStream('agentSession.subscribe', { sessionId: SESSION }, client)
    await call('agentSession.droidCommand', { sessionId: SESSION, command: COMMAND }, client)
    await call(
      'agentSession.mcpSignInOpened',
      { sessionId: SESSION, requestId: 'open-request', opened: false },
      client
    )

    const caller = { connectionId: 'desktop-connection', callerKey: 'desktop-client' }
    expect(hostCalls.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ mcpSignInCaller: caller })
    )
    expect(hostCalls.droidCommand).toHaveBeenCalledWith(SESSION, COMMAND, caller)
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith(
      SESSION,
      'open-request',
      'desktop-connection',
      'desktop-client',
      false
    )
  })

  it('still refuses a client that did not negotiate structured sessions', async () => {
    const response = await call(
      'agentSession.mcpSignInOpened',
      { sessionId: SESSION, requestId: 'open-request', opened: true },
      { ...DESKTOP, clientCapabilities: [AGENT_SESSION_MCP_SIGN_IN_OPEN_CLIENT_CAPABILITY] }
    )

    expect(response).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('structured_agent_session_unsupported') }
    })
    expect(acknowledge).not.toHaveBeenCalled()
  })

  it.each([
    { sessionId: SESSION, opened: true },
    { sessionId: SESSION, requestId: '', opened: true },
    { sessionId: SESSION, requestId: 'x'.repeat(201), opened: true },
    { sessionId: SESSION, requestId: 'open-request' },
    { sessionId: SESSION, requestId: 'open-request', opened: 'yes' },
    { sessionId: SESSION, requestId: 'open-request', opened: true, connectionId: 'forged' },
    { sessionId: SESSION, requestId: 'open-request', opened: true, callerKey: 'forged' }
  ])('rejects malformed or caller-supplied authority before reaching the host', async (params) => {
    const response = await call('agentSession.mcpSignInOpened', params, DESKTOP)

    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(acknowledge).not.toHaveBeenCalled()
  })
})
