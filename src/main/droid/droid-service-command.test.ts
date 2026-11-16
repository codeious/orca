import { afterEach, expect, it } from 'vitest'
import type { AgentSessionMcpOperation } from '../../shared/agent-session/agent-session-mcp'
import { agentSessionRecordFixture } from '../native-chat/testing/agent-session-record-test-fixture'
import type { StructuredAgentSessionAdapter } from '../native-chat/agent-session-wire/providers/structured-agent-session-adapter'
import { runDroidRigCleanups, setupDroidAdapter } from './droid-adapter-rig.test-support'
import { DroidRpcError } from './droid-rpc-errors'
import { readDroidExchanges, replayExchange } from './droid-recording.test-support'

afterEach(runDroidRigCleanups)
const LINK =
  'https://auth.example.invalid/authorize?state=never-persisted&redirect_uri=http%3A%2F%2Flocalhost%3A43117%2Fcallback'

async function rig() {
  const h = await setupDroidAdapter()
  const { connection } = await h.start()
  const adapter: StructuredAgentSessionAdapter = h.adapter
  const record = agentSessionRecordFixture({ sessionId: h.input.identity.sessionId })
  const mcp = (operation: AgentSessionMcpOperation) => adapter.manageMcp?.(record, operation)
  const run = (name: string, argument = '') =>
    adapter.hostCommand?.({
      sessionId: h.input.identity.sessionId,
      fence: 7,
      name,
      argument,
      operationId: 'service-operation'
    })
  return { ...h, connection, mcp, run }
}

it('replays an MCP toggle without sending model messages or retaining provider errors', async () => {
  const h = await rig()
  const exchanges = await readDroidExchanges('mcp')
  const lists = ['r3', 'r5'].map((id) => replayExchange(h.connection, exchanges, id))
  h.connection.replies.set('droid.list_mcp_servers', (params) => lists.shift()?.(params))
  h.connection.replies.set('droid.toggle_mcp_server', replayExchange(h.connection, exchanges, 'r4'))
  expect(await h.mcp({ action: 'toggle', server: 'parmcp-local', enabled: false })).toEqual({
    status: 'ok',
    servers: [
      {
        name: 'parmcp-local',
        status: 'disabled',
        source: 'user',
        toolCount: null,
        error: null,
        canSignIn: false,
        canReconnect: false,
        canToggle: true
      }
    ]
  })
  expect(
    h.connection.requests.find(({ method }) => method === 'droid.toggle_mcp_server')?.params
  ).toEqual({ serverName: 'parmcp-local', enabled: false, settingsLevel: 'user' })
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

it('returns a sign-in link to the panel that asked, never to the chat journal', async () => {
  const h = await rig()
  h.connection.replies.set('droid.list_mcp_servers', () => ({
    servers: [{ name: 'sample', status: 'failed', serverType: 'http', requiresAuth: true }]
  }))
  h.connection.replies.set('droid.authenticate_mcp_server', () => {
    h.connection.notify({ type: 'mcp_auth_required', serverName: 'sample', authUrl: LINK })
    return new Promise(() => {})
  })
  expect(await h.mcp({ action: 'signIn', server: 'sample' })).toMatchObject({
    status: 'ok',
    servers: [{ name: 'sample', status: 'needs-auth', canSignIn: true }],
    signIn: { server: 'sample', url: LINK, finish: 'callback' }
  })
  await expect(
    h.mcp({
      action: 'finishSignIn',
      server: 'sample',
      callbackUrl: 'http://127.0.0.1:43117/elsewhere?code=1'
    })
  ).rejects.toThrow("doesn't match the sign-in in progress")
  expect(JSON.stringify(await h.rig.rows())).not.toMatch(/auth\.example|never-persisted|authUrl/)
})

it('redacts provider errors that repeat a sign-in link', async () => {
  const h = await rig()
  h.connection.replies.set('droid.list_mcp_servers', () => {
    throw new DroidRpcError(-32000, LINK)
  })
  await expect(h.mcp({ action: 'status' })).rejects.toThrow(
    'Droid could not complete this MCP action.'
  )
  expect(JSON.stringify(await h.rig.rows())).not.toContain(LINK)
})

it('reports a chat with no running Droid as not running', async () => {
  const h = await setupDroidAdapter()
  const record = agentSessionRecordFixture({ sessionId: h.input.identity.sessionId })
  expect(await h.adapter.manageMcp(record, { action: 'status' })).toEqual({
    status: 'not-running'
  })
})
