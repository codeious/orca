import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter
} from './droid-adapter-rig.test-support'
import { DroidMcpSignIn } from './droid-mcp-sign-in'
import { runDroidServiceCommand } from './droid-service-command'
import { DroidRpcError } from './droid-rpc-errors'
import { readDroidExchanges, replayExchange } from './droid-recording.test-support'

afterEach(runDroidRigCleanups)
const LINK = 'https://auth.example.invalid/authorize?state=never-persisted'
const MCP = 'droid.list_mcp_servers'
const AUTH = 'droid.authenticate_mcp_server'

async function rig() {
  const h = await setupDroidAdapter()
  const { connection } = await h.start()
  let operation = 0
  const run = (
    name: string,
    argument = '',
    openMcpSignIn?: (url: string) => boolean | Promise<boolean>
  ) =>
    h.adapter.hostCommand({
      sessionId: DROID_RIG_SESSION,
      fence: 7,
      name,
      argument,
      operationId: `service-${++operation}`,
      openMcpSignIn
    })
  return { ...h, connection, run }
}

describe('Droid service host text', () => {
  it('replays small MCP exchanges through hostCommand, without model messages or provider errors', async () => {
    const h = await rig()
    const exchanges = await readDroidExchanges('mcp')
    const lists = ['r1', 'r3', 'r5', 'r1'].map((id) => replayExchange(h.connection, exchanges, id))
    h.connection.replies.set(MCP, (params) => lists.shift()?.(params))
    h.connection.replies.set('droid.add_mcp_server', replayExchange(h.connection, exchanges, 'r2'))
    expect(await h.run('mcp', 'add parmcp-local stdio /work/probe/mcp-server.sh')).toEqual({
      text: 'parmcp-local: added\nparmcp-local: failed'
    })
    h.connection.replies.set(
      'droid.toggle_mcp_server',
      replayExchange(h.connection, exchanges, 'r4')
    )
    // The before and after listings are separate requests.
    lists.unshift(replayExchange(h.connection, exchanges, 'r3'))
    expect(await h.run('mcp', 'disable parmcp-local')).toEqual({
      text: 'parmcp-local: disabled\nparmcp-local: disabled'
    })
    expect(h.connection.requests.some(({ method }) => method === 'droid.add_user_message')).toBe(
      false
    )
    expect(JSON.stringify(await h.rig.rows())).not.toContain('Failed to connect')
  })

  it('lists and toggles skills with includeContent false, retaining no skill content', async () => {
    const h = await rig()
    const exchanges = await readDroidExchanges('skills')
    const lists = ['r1', 'r1', 'r3'].map((id) => replayExchange(h.connection, exchanges, id))
    h.connection.replies.set('droid.list_skills', (params) => lists.shift()?.(params))
    h.connection.replies.set(
      'droid.set_skill_disabled',
      replayExchange(h.connection, exchanges, 'r2')
    )
    expect(await h.run('skills')).toEqual({ text: 'sample: enabled' })
    expect(await h.run('skills', 'disable sample')).toEqual({ text: 'sample: disabled' })
    expect(
      h.connection.requests
        .filter(({ method }) => method === 'droid.list_skills')
        .every(({ params }) => JSON.stringify(params) === '{"includeContent":false}')
    ).toBe(true)
    expect(await h.rig.turns()).toHaveLength(0)
    expect(h.connection.requests.some(({ method }) => method === 'droid.add_user_message')).toBe(
      false
    )
  })

  it('forwards only a running sign-in challenge and keeps links out of text and journal rows', async () => {
    const h = await rig()
    h.connection.replies.set(MCP, () => ({
      servers: [
        {
          name: 'sample',
          status: 'disconnected',
          serverType: 'http',
          requiresAuth: true,
          pendingAuthUrl: LINK
        }
      ]
    }))
    const open = vi.fn(async () => true)
    h.connection.replies.set(AUTH, () => {
      h.connection.notify({ type: 'mcp_auth_required', serverName: 'sample', authUrl: LINK })
      h.connection.notify({ type: 'mcp_auth_required', serverName: 'sample', authUrl: LINK })
      return { success: true }
    })
    const answer = await h.run('mcp', 'sign-in sample', open)
    expect(open).toHaveBeenCalledExactlyOnceWith(LINK)
    expect(answer.text).toContain('signed-in')
    h.connection.notify({ type: 'mcp_auth_required', serverName: 'sample', authUrl: LINK })
    expect(open).toHaveBeenCalledOnce()
    expect(JSON.stringify([answer, await h.rig.rows()])).not.toMatch(
      /auth\.example|never-persisted|authUrl/
    )
  })

  it.each([false, 'reject'] as const)(
    'refuses unopened links (%s), even when Droid already answered',
    async (verdict) => {
      const h = await rig()
      h.connection.replies.set(MCP, () => ({
        servers: [{ name: 'sample', status: 'disconnected' }]
      }))
      h.connection.replies.set(AUTH, () => {
        h.connection.notify({ type: 'mcp_auth_required', serverName: 'sample', authUrl: LINK })
        return { success: true }
      })
      await expect(
        h.run('mcp', 'sign-in sample', async () => {
          if (verdict === 'reject') {
            throw new Error(LINK)
          }
          return false
        })
      ).rejects.toThrow('could not be opened')
      expect(JSON.stringify(await h.rig.rows())).not.toContain(LINK)
    }
  )

  it('drops provider failures that repeat a sign-in URL', async () => {
    const h = await rig()
    h.connection.replies.set(MCP, () => {
      throw new DroidRpcError(-32000, LINK)
    })
    await expect(h.run('mcp')).rejects.toThrow('Droid could not complete this service command.')
    expect(JSON.stringify(await h.rig.rows())).not.toContain(LINK)
  })

  it('rejects malformed actions before calling Droid', async () => {
    const request = vi.fn(async () => ({}))
    const session = { request, mcpSignIn: new DroidMcpSignIn() }
    for (const [name, argument] of [
      ['mcp', 'sign-in'],
      ['mcp', 'add sample http file:///tmp/test'],
      ['mcp', 'add sample http https://user:pass@example.invalid'],
      ['skills', 'enable'],
      ['skills', '"unfinished']
    ]) {
      await expect(runDroidServiceCommand(session, { name, argument })).rejects.toThrow()
    }
    expect(request).not.toHaveBeenCalled()
  })
})
