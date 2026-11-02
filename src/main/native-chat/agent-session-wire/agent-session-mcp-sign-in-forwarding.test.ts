import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentSessionMcpSignInForwarding,
  MCP_SIGN_IN_OPEN_ACK_TIMEOUT_MS,
  type McpSignInOpenRequest
} from './agent-session-mcp-sign-in-forwarding'

const CALLER = { callerKey: 'client', connectionId: 'connection' }
const LINK = 'https://auth.example.invalid/?state=in-memory'
afterEach(() => vi.useRealTimers())

describe('initiating-client sign-in forwarding', () => {
  it('selects the exact live caller, connection and chat, and rejects forged acknowledgments', async () => {
    const forwarding = new AgentSessionMcpSignInForwarding()
    const other = vi.fn()
    for (const [id, identity] of [
      ['old', { ...CALLER, connectionId: 'old', sessionId: 'chat' }],
      ['other', { ...CALLER, callerKey: 'other', sessionId: 'chat' }],
      ['other-chat', { ...CALLER, sessionId: 'other-chat' }]
    ] as const) {
      forwarding.subscribe(id, { ...identity, send: other })
    }
    const sent: McpSignInOpenRequest[] = []
    forwarding.subscribe('reader', { ...CALLER, sessionId: 'chat', send: (r) => sent.push(r) })
    const pending = forwarding.run('chat', CALLER, 'mcp', async () => {
      expect(await forwarding.open('chat', LINK, 'mcp')).toBe(true)
      return 'done'
    })
    const request = sent[0]
    if (!request) {
      throw new Error('Expected one transient request')
    }
    expect(request.url).toBe(LINK)
    expect(other).not.toHaveBeenCalled()
    expect(
      forwarding.acknowledge('other-chat', request.requestId, 'connection', 'client', true)
    ).toBe(false)
    expect(forwarding.acknowledge('chat', request.requestId, 'old', 'client', true)).toBe(false)
    expect(forwarding.acknowledge('chat', request.requestId, 'connection', 'other', true)).toBe(
      false
    )
    expect(forwarding.acknowledge('chat', request.requestId, 'connection', 'client', true)).toBe(
      true
    )
    await expect(pending).resolves.toBe('done')
    expect(forwarding.acknowledge('chat', request.requestId, 'connection', 'client', true)).toBe(
      false
    )
    expect(forwarding.open('chat', LINK, 'mcp')).toBe(false)
  })

  it('waits for browser acknowledgment even when the provider answers first, and opens only once', async () => {
    const forwarding = new AgentSessionMcpSignInForwarding()
    const send = vi.fn()
    forwarding.subscribe('reader', { ...CALLER, sessionId: 'chat', send })
    const pending = forwarding
      .run('chat', CALLER, 'mcp', async () => {
        const first = forwarding.open('chat', LINK, 'mcp')
        expect(forwarding.open('chat', LINK, 'mcp')).toBe(first)
        return 'provider answered'
      })
      .catch((error: unknown) => error)
    const request = send.mock.calls[0]?.[0]
    expect(send).toHaveBeenCalledOnce()
    expect(forwarding.acknowledge('chat', request.requestId, 'connection', 'client', false)).toBe(
      true
    )
    await expect(pending).resolves.toMatchObject({
      message: expect.stringContaining('could not be opened')
    })
  })

  it('cancels pending opens when a subscriber disconnects without retargeting another reader', async () => {
    const forwarding = new AgentSessionMcpSignInForwarding()
    const close = forwarding.subscribe('reader', { ...CALLER, sessionId: 'chat', send: () => {} })
    const pending = forwarding
      .run('chat', CALLER, 'mcp', async () => forwarding.open('chat', LINK, 'mcp'))
      .catch((error: unknown) => error)
    close()
    const replacement = vi.fn()
    forwarding.subscribe('new', { ...CALLER, sessionId: 'chat', send: replacement })
    await expect(pending).resolves.toMatchObject({
      message: expect.stringContaining('could not be opened')
    })
    expect(replacement).not.toHaveBeenCalled()
  })

  it('times out missing acknowledgments and refuses missing initiating readers', async () => {
    vi.useFakeTimers()
    const forwarding = new AgentSessionMcpSignInForwarding()
    forwarding.subscribe('reader', { ...CALLER, sessionId: 'chat', send: () => {} })
    const pending = forwarding
      .run('chat', CALLER, 'mcp', async () => forwarding.open('chat', LINK, 'mcp'))
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(MCP_SIGN_IN_OPEN_ACK_TIMEOUT_MS)
    await expect(pending).resolves.toMatchObject({
      message: expect.stringContaining('could not be opened')
    })
    expect(
      await forwarding.run('chat', undefined, 'mcp', async () =>
        forwarding.open('chat', LINK, 'mcp')
      )
    ).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
