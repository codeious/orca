import { afterEach, expect, it, vi } from 'vitest'
import type { StructuredAgentSessionAdapter } from '../native-chat/agent-session-wire/providers/structured-agent-session-adapter'
import { runDroidRigCleanups, setupDroidAdapter } from './droid-adapter-rig.test-support'
import { DroidRpcError } from './droid-rpc-errors'
import { readDroidExchanges, replayExchange } from './droid-recording.test-support'

afterEach(runDroidRigCleanups)
const LINK = 'https://auth.example.invalid/authorize?state=never-persisted'

async function rig() {
  const h = await setupDroidAdapter()
  const { connection } = await h.start()
  const adapter: StructuredAgentSessionAdapter = h.adapter
  const run = async (
    name: string,
    argument = '',
    openMcpSignIn?: (url: string) => boolean | Promise<boolean>
  ) =>
    adapter.hostCommand?.({
      sessionId: h.input.identity.sessionId,
      fence: 7,
      name,
      argument,
      operationId: 'service-operation',
      openMcpSignIn
    })
  return { ...h, connection, run }
}

it('replays MCP changes without sending model messages or retaining provider errors', async () => {
  const h = await rig()
  const exchanges = await readDroidExchanges('mcp')
  const lists = ['r1', 'r3', 'r5'].map((id) => replayExchange(h.connection, exchanges, id))
  h.connection.replies.set('droid.list_mcp_servers', (params) => lists.shift()?.(params))
  h.connection.replies.set('droid.add_mcp_server', replayExchange(h.connection, exchanges, 'r2'))
  expect(await h.run('mcp', 'add parmcp-local stdio /work/probe/mcp-server.sh')).toEqual({
    text: 'parmcp-local: added\nparmcp-local: failed'
  })
  h.connection.replies.set('droid.toggle_mcp_server', replayExchange(h.connection, exchanges, 'r4'))
  lists.unshift(replayExchange(h.connection, exchanges, 'r3'))
  expect(await h.run('mcp', 'disable parmcp-local')).toEqual({
    text: 'parmcp-local: disabled\nparmcp-local: disabled'
  })
  expect(h.connection.requests.some(({ method }) => method === 'droid.add_user_message')).toBe(
    false
  )
  expect(JSON.stringify(await h.rig.rows())).not.toContain('Failed to connect')
})

it('lists and toggles skills without requesting their content or sending a model message', async () => {
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
      .map(({ params }) => params)
  ).toEqual([{ includeContent: false }, { includeContent: false }, { includeContent: false }])
  expect(h.connection.requests.some(({ method }) => method === 'droid.add_user_message')).toBe(
    false
  )
})

it('delivers a running sign-in link to its opener, never to the chat journal', async () => {
  const h = await rig()
  h.connection.replies.set('droid.list_mcp_servers', () => ({
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
  h.connection.replies.set('droid.authenticate_mcp_server', () => {
    h.connection.notify({ type: 'mcp_auth_required', serverName: 'sample', authUrl: LINK })
    return { success: true }
  })
  expect(await h.run('mcp', 'sign-in sample', open)).toMatchObject({ text: expect.any(String) })
  expect(open).toHaveBeenCalledWith(LINK)
  expect(JSON.stringify(await h.rig.rows())).not.toMatch(/auth\.example|never-persisted|authUrl/)
})

it('refuses a successful provider answer when the sign-in link could not be opened', async () => {
  const h = await rig()
  h.connection.replies.set('droid.list_mcp_servers', () => ({
    servers: [{ name: 'sample', status: 'disconnected' }]
  }))
  h.connection.replies.set('droid.authenticate_mcp_server', () => {
    h.connection.notify({ type: 'mcp_auth_required', serverName: 'sample', authUrl: LINK })
    return { success: true }
  })
  await expect(h.run('mcp', 'sign-in sample', async () => false)).rejects.toThrow(
    'could not be opened'
  )
  expect(JSON.stringify(await h.rig.rows())).not.toContain(LINK)
})

it('redacts provider errors that repeat a sign-in link', async () => {
  const h = await rig()
  h.connection.replies.set('droid.list_mcp_servers', () => {
    throw new DroidRpcError(-32000, LINK)
  })
  await expect(h.run('mcp')).rejects.toThrow('Droid could not complete this service command.')
  expect(JSON.stringify(await h.rig.rows())).not.toContain(LINK)
})
