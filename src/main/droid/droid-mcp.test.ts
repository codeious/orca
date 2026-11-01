// Shapes are those of the Droid 0.251.0 capture (`session-extras`); the server in `mcp.jsonl` is a
// stand-in, so the sign-in leg that capture refused (a stdio server) is recorded as r8.
import { afterEach, describe, expect, it } from 'vitest'
import type {
  DroidHostCommand,
  DroidHostCommandResult,
  DroidMcpAction
} from '../../shared/droid-host-command'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type FakeConnection
} from './droid-adapter-rig.test-support'
import { readDroidExchanges, replayExchange } from './droid-recording.test-support'
import { DroidRpcError } from './droid-rpc-errors'

afterEach(runDroidRigCleanups)

const LIST = 'droid.list_mcp_servers'
const ADD = 'droid.add_mcp_server'
const TOGGLE = 'droid.toggle_mcp_server'
const REMOVE = 'droid.remove_mcp_server'
const SERVER = 'parmcp-local'

async function sessionIn() {
  const h = await setupDroidAdapter({ cwd: '/work/probe' })
  const { connection } = await h.start()
  const run = (action: DroidMcpAction) => {
    const command: DroidHostCommand = { name: 'mcp', action }
    return h.adapter.droidCommand({ sessionId: DROID_RIG_SESSION, fence: 7, command })
  }
  return { h, connection, run }
}

const asked = (connection: FakeConnection, method: string) =>
  connection.requests.filter((request) => request.method === method)

/** The recorded exchanges, answered as the connection is asked: listings in the order given. */
async function recorded(
  connection: FakeConnection,
  listings: ('r1' | 'r3' | 'r5')[],
  change?: 'r2' | 'r4' | 'r6' | 'r7'
) {
  const exchanges = await readDroidExchanges('mcp')
  const lists = listings.map((id) => replayExchange(connection, exchanges, id))
  connection.replies.set(LIST, (params) => lists.shift()?.(params))
  if (change) {
    const method = exchanges.get(change)?.method ?? ''
    connection.replies.set(method, replayExchange(connection, exchanges, change))
  }
}

const mcpOf = (result: DroidHostCommandResult) => {
  if (result.name !== 'mcp') {
    throw new Error(`answered ${result.name}`)
  }
  return result
}

const ADD_LOCAL: DroidMcpAction = {
  kind: 'add',
  serverName: SERVER,
  server: { type: 'stdio', command: '/work/probe/mcp-server.sh', args: [] }
}

describe('Droid /mcp', () => {
  it('lists the servers Droid lists, by name, state, kind and tool count, with nothing else of them', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r3'])

    const result = mcpOf(await run({ kind: 'list' }))

    expect(asked(connection, LIST)).toEqual([{ method: LIST, params: {} }])
    expect(result.changed).toBeNull()
    expect(result.servers).toEqual([
      { name: SERVER, status: 'failed', type: 'stdio', toolCount: null, needsSignIn: false }
    ])
    expect(connection.requests.map(({ method }) => method)).toEqual([
      'droid.initialize_session',
      LIST
    ])
  })

  it('lists no servers as an empty list', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r1'])

    expect(await run({ kind: 'list' })).toEqual({ name: 'mcp', servers: [], changed: null })
  })

  it('keeps a pending sign-in link out of the answer and says the server needs a sign-in', async () => {
    const { connection, run } = await sessionIn()
    const link = 'https://auth.example.invalid/authorize?state=held-in-memory'
    connection.replies.set(LIST, () => ({
      servers: [
        {
          name: 'remote',
          status: 'disconnected',
          source: 'user',
          isManaged: false,
          serverType: 'http',
          requiresAuth: true,
          hasAuthTokens: false,
          pendingAuthUrl: link,
          pendingAuthMessage: `Open ${link}`,
          pendingAuthState: 'held-in-memory'
        }
      ],
      summary: { total: 1, connected: 0, connecting: 0, failed: 0, disabled: 0 }
    }))

    const result = mcpOf(await run({ kind: 'list' }))

    expect(result.servers).toEqual([
      { name: 'remote', status: 'disconnected', type: 'http', toolCount: null, needsSignIn: true }
    ])
    expect(JSON.stringify(result).includes('auth.example.invalid')).toBe(false)
    expect(JSON.stringify(result).includes('held-in-memory')).toBe(false)
  })

  it('adds a stdio server by name, command and arguments, then lists so the answer is what Droid now holds', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r1', 'r3'], 'r2')

    const result = mcpOf(await run(ADD_LOCAL))

    expect(connection.requests.map(({ method }) => method)).toEqual([
      'droid.initialize_session',
      LIST,
      ADD,
      LIST
    ])
    expect(asked(connection, ADD)[0]?.params).toEqual({
      name: SERVER,
      type: 'stdio',
      command: '/work/probe/mcp-server.sh',
      args: []
    })
    expect(result.changed).toEqual({ kind: 'added', serverName: SERVER })
    expect(result.servers.map(({ name }) => name)).toEqual([SERVER])
  })

  it.each(['http', 'sse'] as const)('adds a %s server by its address', async (type) => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r1', 'r3'], 'r2')

    await run({
      kind: 'add',
      serverName: SERVER,
      server: { type, url: 'https://mcp.example.invalid/endpoint' }
    })

    expect(asked(connection, ADD)[0]?.params).toEqual({
      name: SERVER,
      type,
      url: 'https://mcp.example.invalid/endpoint'
    })
  })

  it('turns a server off at the user level and reads it as off from the next listing', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r3', 'r5'], 'r4')

    const result = mcpOf(await run({ kind: 'toggle', serverName: SERVER, enabled: false }))

    expect(asked(connection, TOGGLE)[0]?.params).toEqual({
      serverName: SERVER,
      enabled: false,
      settingsLevel: 'user'
    })
    expect(result.changed).toEqual({ kind: 'disabled', serverName: SERVER })
    expect(result.servers[0]?.status).toBe('disabled')
  })

  it('turns a server back on at the user level', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r5', 'r3'], 'r6')

    const result = mcpOf(await run({ kind: 'toggle', serverName: SERVER, enabled: true }))

    expect(asked(connection, TOGGLE)[0]?.params).toEqual({
      serverName: SERVER,
      enabled: true,
      settingsLevel: 'user'
    })
    expect(result.changed).toEqual({ kind: 'enabled', serverName: SERVER })
    expect(result.servers[0]?.status).toBe('failed')
  })

  it('removes a server at the user level and lists none', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r3', 'r1'], 'r7')

    const result = mcpOf(await run({ kind: 'remove', serverName: SERVER }))

    expect(asked(connection, REMOVE)[0]?.params).toEqual({
      serverName: SERVER,
      settingsLevel: 'user'
    })
    expect(result).toEqual({
      name: 'mcp',
      servers: [],
      changed: { kind: 'removed', serverName: SERVER }
    })
  })

  it('refuses to add a name Droid already lists, and sends no add', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r3'])

    await expect(run(ADD_LOCAL)).rejects.toMatchObject({
      message: `Droid already has an MCP server named ${SERVER}.`,
      textKey: 'components.native-chat.droidHost.mcpDuplicate',
      textParams: { serverName: SERVER }
    })

    expect(asked(connection, ADD)).toEqual([])
  })

  it.each([
    ['turn on', { kind: 'toggle', serverName: 'nope', enabled: true } as const, TOGGLE],
    ['remove', { kind: 'remove', serverName: 'nope' } as const, REMOVE],
    [
      'sign in to',
      { kind: 'sign-in', serverName: 'nope' } as const,
      'droid.authenticate_mcp_server'
    ]
  ])('names a server Droid does not list, and does not %s it', async (_label, action, method) => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r3'])

    await expect(run(action)).rejects.toMatchObject({
      message: 'Droid has no MCP server named nope.',
      textKey: 'components.native-chat.droidHost.mcpUnknown',
      textParams: { serverName: 'nope' }
    })

    expect(asked(connection, method)).toEqual([])
  })

  it('says so when Droid answers that it did not add the server', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r1'])
    connection.replies.set(ADD, () => ({ success: false }))

    await expect(run(ADD_LOCAL)).rejects.toMatchObject({
      message: `Droid did not add ${SERVER}.`,
      textKey: 'components.native-chat.droidHost.mcpNotAdded',
      textParams: { serverName: SERVER }
    })
  })

  it('says so when Droid gives no verdict on a removal', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r3'])
    connection.replies.set(REMOVE, () => ({}))

    await expect(run({ kind: 'remove', serverName: SERVER })).rejects.toMatchObject({
      message: `Droid did not remove ${SERVER}.`,
      textKey: 'components.native-chat.droidHost.mcpNotRemoved',
      textParams: { serverName: SERVER }
    })
  })

  it.each([
    ['adding', ['r1', 'r1'], ADD_LOCAL, `Droid did not add ${SERVER}.`, 'r2', 'mcpNotAdded'],
    [
      'removing',
      ['r3', 'r3'],
      { kind: 'remove', serverName: SERVER } as const,
      `Droid still lists ${SERVER}.`,
      'r7',
      'mcpStillListed'
    ],
    [
      'turning off',
      ['r3', 'r3'],
      { kind: 'toggle', serverName: SERVER, enabled: false } as const,
      `Droid still lists ${SERVER} as on.`,
      'r4',
      'mcpStillOn'
    ],
    [
      'turning on',
      ['r5', 'r5'],
      { kind: 'toggle', serverName: SERVER, enabled: true } as const,
      `Droid still lists ${SERVER} as off.`,
      'r6',
      'mcpStillOff'
    ]
  ] as const)(
    'says so when, after %s, the next listing still shows the server as it was',
    async (_label, listings, action, words, change, key) => {
      const { connection, run } = await sessionIn()
      await recorded(connection, [...listings], change)

      await expect(run(action)).rejects.toMatchObject({
        message: words,
        textKey: `components.native-chat.droidHost.${key}`,
        textParams: { serverName: SERVER }
      })
    }
  )

  it.each([
    ['nothing', {}],
    ['a list that is not a list', { servers: 'all' }],
    ['a server with no name', { servers: [{ status: 'connected' }] }],
    ['a server with no state', { servers: [{ name: SERVER }] }]
  ])('says so when Droid lists %s it can read', async (_label, answer) => {
    const { connection, run } = await sessionIn()
    connection.replies.set(LIST, () => answer)

    await expect(run({ kind: 'list' })).rejects.toMatchObject({
      message: 'Droid did not list its MCP servers. Try again.',
      textKey: 'components.native-chat.droidHost.mcpUnreadable'
    })
  })

  it.each([
    [true, 'mcpNotOn', `Droid did not turn ${SERVER} on.`],
    [false, 'mcpNotOff', `Droid did not turn ${SERVER} off.`]
  ] as const)('keys a refused toggle to %s', async (enabled, key, message) => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r3'])
    connection.replies.set(TOGGLE, () => ({ success: false }))

    await expect(run({ kind: 'toggle', serverName: SERVER, enabled })).rejects.toMatchObject({
      message,
      textKey: `components.native-chat.droidHost.${key}`,
      textParams: { serverName: SERVER }
    })
  })

  it('says Droid needs updating when it has no listing method', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set(LIST, () => {
      throw new DroidRpcError(-32601, 'Method not found')
    })

    await expect(run({ kind: 'list' })).rejects.toThrow(
      'Listing MCP servers needs a newer Droid. Update Droid and try again.'
    )
  })

  it('says Droid needs updating when it lists servers but cannot add one', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, ['r1'])
    connection.replies.set(ADD, () => {
      throw new DroidRpcError(-32601, 'Method not found')
    })

    await expect(run(ADD_LOCAL)).rejects.toThrow(
      'Adding an MCP server needs a newer Droid. Update Droid and try again.'
    )
  })

  it('opens no turn and sends no message', async () => {
    const { h, connection, run } = await sessionIn()
    await recorded(connection, ['r1', 'r3', 'r5', 'r3', 'r1'], 'r2')

    await run(ADD_LOCAL)

    expect(await h.rig.turns()).toHaveLength(0)
    expect(await h.rig.rows()).toEqual([])
    expect(connection.requests.map(({ method }) => method)).not.toContain('droid.add_user_message')
    expect(h.settled).not.toHaveBeenCalled()
  })
})
