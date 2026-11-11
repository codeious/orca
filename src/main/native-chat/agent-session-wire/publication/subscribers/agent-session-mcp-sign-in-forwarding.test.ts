import { describe, expect, it, vi } from 'vitest'
import {
  AgentSessionMcpSignInForwarding,
  type McpSignInOpenRequest
} from './agent-session-mcp-sign-in-forwarding'

const CALLER = { callerKey: 'client', connectionId: 'connection' }
const LINK = 'https://auth.example.invalid/?state=in-memory'

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
    const pending = forwarding.run('chat', CALLER, 'mcp', async () =>
      forwarding.open('chat', LINK, 'mcp')
    )
    expect(sent).toEqual([
      {
        requestId: expect.any(String),
        url: 'https://auth.example.invalid/?state=in-memory'
      }
    ])
    const request = sent[0]
    if (!request) {
      throw new Error('Expected one transient request')
    }
    expect(request.url).toBe('https://auth.example.invalid/?state=in-memory')
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
    await expect(pending).resolves.toBe(true)
    expect(forwarding.acknowledge('chat', request.requestId, 'connection', 'client', true)).toBe(
      false
    )
    expect(forwarding.open('chat', LINK, 'mcp')).toBe(false)
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
})
