// A fake Droid peer raises the sign-in challenge. Nothing here opens a browser or reaches a server:
// the open is a spy, and the link is checked to stay out of every place Orca writes.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DroidHostCommand, DroidMcpAction } from '../../shared/droid-host-command'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type FakeConnection
} from './droid-adapter-rig.test-support'
import { readDroidExchanges, replayExchange } from './droid-recording.test-support'
import { DroidHostTextError } from './droid-host-text'
import { DroidMcpSignInStopped } from './droid-mcp-sign-in'
import {
  DroidConnectionClosedError,
  DroidRequestTimeoutError,
  DroidRpcError
} from './droid-rpc-errors'

afterEach(runDroidRigCleanups)

const LIST = 'droid.list_mcp_servers'
const AUTHENTICATE = 'droid.authenticate_mcp_server'
const SUBMIT_CODE = 'droid.submit_mcp_auth_code'
const SIGN_IN_URL = 'https://auth.example.invalid/authorize?client=fake&state=held-in-memory'
const GUEST_HOST = 'runtime:5c2e9a7e-1111-4222-8333-944455556666'

const REMOTE = {
  name: 'remote',
  source: 'user',
  isManaged: false,
  status: 'disconnected',
  serverType: 'http',
  requiresAuth: true,
  hasAuthTokens: false
}
const SIGN_IN: DroidMcpAction = { kind: 'sign-in', serverName: 'remote' }

/** `none` is a host that has no way to open a link at all. */
type Opener = ((url: string) => boolean | Promise<boolean>) | 'none'

async function sessionIn(hostId = 'local', opener: Opener = () => true) {
  const open = vi.fn(opener === 'none' ? () => false : opener)
  const logger = { warn: vi.fn(), error: vi.fn() }
  const h = await setupDroidAdapter(
    { cwd: '/work/probe' },
    undefined,
    opener === 'none' ? { logger } : { logger, openMcpSignIn: open },
    hostId
  )
  const { connection } = await h.start()
  connection.replies.set(LIST, () => ({
    servers: [REMOTE],
    summary: { total: 1, connected: 0, connecting: 0, failed: 0, disabled: 0 }
  }))
  const run = (action: DroidMcpAction) => {
    const command: DroidHostCommand = { name: 'mcp', action }
    return h.adapter.droidCommand({ sessionId: DROID_RIG_SESSION, fence: 7, command })
  }
  return { h, connection, run, open, logger }
}

const challenge = (connection: FakeConnection, state = 'st-1') =>
  connection.notify({
    type: 'mcp_auth_required',
    serverName: 'remote',
    authUrl: SIGN_IN_URL,
    message: `Open ${SIGN_IN_URL} to sign in`,
    state
  })

const completed = (connection: FakeConnection, outcome: 'success' | 'cancelled' | 'failed') =>
  connection.notify({
    type: 'mcp_auth_completed',
    serverName: 'remote',
    outcome,
    message: `Signed in at ${SIGN_IN_URL}`
  })

/** Droid raising the challenge while the sign-in request is open, then answering it. */
function raisesChallenge(connection: FakeConnection, outcome: 'success' | 'cancelled' | 'failed') {
  connection.replies.set(AUTHENTICATE, () => {
    challenge(connection)
    completed(connection, outcome)
    return { success: outcome === 'success' }
  })
}

/** Every place the host writes or answers: the journal rows, the logs, the answer itself. */
async function whatTheHostWrote(
  h: Awaited<ReturnType<typeof sessionIn>>['h'],
  logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> },
  answer: unknown
): Promise<string> {
  return JSON.stringify([
    await h.rig.rows(),
    logger.warn.mock.calls,
    logger.error.mock.calls,
    answer
  ])
}

const leaks = (written: string) =>
  written.includes('auth.example.invalid') ||
  written.includes('held-in-memory') ||
  written.includes('authUrl')

describe.each([
  ['a local session', 'local'],
  ['a session on a runtime host', GUEST_HOST]
])('Droid /mcp sign-in on %s', (_label, hostId) => {
  it('asks this machine to open the link once, then answers once Droid says it is signed in', async () => {
    const { h, connection, run, open, logger } = await sessionIn(hostId)
    raisesChallenge(connection, 'success')

    const result = await run(SIGN_IN)

    expect(open).toHaveBeenCalledExactlyOnceWith(SIGN_IN_URL)
    expect(connection.requests.filter(({ method }) => method === AUTHENTICATE)).toHaveLength(1)
    expect(connection.requests.map(({ method }) => method)).not.toContain(SUBMIT_CODE)
    expect(result).toMatchObject({
      name: 'mcp',
      changed: { kind: 'signed-in', serverName: 'remote' }
    })
    expect(leaks(await whatTheHostWrote(h, logger, result))).toBe(false)
  })

  it('sends the sign-in to the session it belongs to, with a wait that ends', async () => {
    const { connection, run } = await sessionIn(hostId)
    raisesChallenge(connection, 'success')

    await run(SIGN_IN)

    const request = connection.requests.find(({ method }) => method === AUTHENTICATE)
    expect(request?.params).toEqual({ serverName: 'remote' })
    expect(request?.timeoutMs).toBeGreaterThan(0)
    expect(request?.timeoutMs).toBeLessThan(195_000)
  })

  it('keeps the link out of the journal, the logs and the answer when the open is refused', async () => {
    const { h, connection, run, open, logger } = await sessionIn(hostId, () => false)
    connection.replies.set(AUTHENTICATE, () => {
      challenge(connection)
      return new Promise(() => {})
    })

    const failure = await run(SIGN_IN).catch((error: unknown) => error)

    expect(open).toHaveBeenCalledOnce()
    expect(failure).toBeInstanceOf(DroidMcpSignInStopped)
    expect(failure).toBeInstanceOf(DroidHostTextError)
    expect(failure).toMatchObject({
      message: 'Orca could not open the sign-in link for remote on this host.',
      textKey: 'components.native-chat.droidHost.mcpLinkNotOpened',
      textParams: { serverName: 'remote' }
    })
    expect(leaks(await whatTheHostWrote(h, logger, failure))).toBe(false)
  })

  it('keeps a link out of the logs when the open throws with it in the message', async () => {
    const { h, connection, run, logger } = await sessionIn(hostId, () => {
      throw new Error(`cannot open ${SIGN_IN_URL}`)
    })
    connection.replies.set(AUTHENTICATE, () => {
      challenge(connection)
      return new Promise(() => {})
    })

    const failure = await run(SIGN_IN).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      message: 'Orca could not open the sign-in link for remote on this host.',
      textKey: 'components.native-chat.droidHost.mcpLinkNotOpened',
      textParams: { serverName: 'remote' }
    })
    expect(leaks(await whatTheHostWrote(h, logger, failure))).toBe(false)
  })

  it('opens the link of a challenge Droid raises on its own, and only once for one state', async () => {
    const { h, connection, open, logger } = await sessionIn(hostId)

    challenge(connection, 'st-1')
    challenge(connection, 'st-1')
    challenge(connection, 'st-2')

    expect(open.mock.calls).toEqual([[SIGN_IN_URL], [SIGN_IN_URL]])
    expect(await h.rig.rows()).toEqual([])
    expect(leaks(await whatTheHostWrote(h, logger, null))).toBe(false)
  })

  it('does not end the child on a challenge it cannot read', async () => {
    const { connection, open } = await sessionIn(hostId)

    connection.notify({ type: 'mcp_auth_required', serverName: 'remote' })
    connection.notify({ type: 'mcp_auth_required', authUrl: SIGN_IN_URL })

    expect(open).not.toHaveBeenCalled()
    expect(connection.closed).toBe(false)
  })

  it('sends the add and the toggle of an MCP server to this session’s own peer', async () => {
    const { connection, run } = await sessionIn(hostId)
    let servers: unknown[] = []
    connection.replies.set(LIST, () => ({ servers, summary: {} }))
    connection.replies.set('droid.add_mcp_server', () => {
      servers = [{ name: 'guest-local', status: 'connecting', serverType: 'stdio' }]
      return { success: true }
    })
    connection.replies.set('droid.toggle_mcp_server', () => {
      servers = [{ name: 'guest-local', status: 'disabled', serverType: 'stdio' }]
      return { success: true }
    })

    await run({
      kind: 'add',
      serverName: 'guest-local',
      server: { type: 'stdio', command: '/guest/mcp.sh', args: ['--quiet'] }
    })
    await run({ kind: 'toggle', serverName: 'guest-local', enabled: false })

    expect(
      connection.requests
        .filter(({ method }) => method.endsWith('_mcp_server'))
        .map(({ method, params }) => [method, params])
    ).toEqual([
      [
        'droid.add_mcp_server',
        { name: 'guest-local', type: 'stdio', command: '/guest/mcp.sh', args: ['--quiet'] }
      ],
      [
        'droid.toggle_mcp_server',
        { serverName: 'guest-local', enabled: false, settingsLevel: 'user' }
      ]
    ])
  })
})

describe('Droid /mcp sign-in refusals', () => {
  it('answers a stdio server’s -32603 with no link and no open', async () => {
    const { h, connection, run, open, logger } = await sessionIn()
    const exchanges = await readDroidExchanges('mcp')
    connection.replies.set(LIST, () => ({
      servers: [{ name: 'parmcp-local', status: 'failed', serverType: 'stdio' }],
      summary: {}
    }))
    connection.replies.set(AUTHENTICATE, replayExchange(connection, exchanges, 'r8'))

    const failure = await run({ kind: 'sign-in', serverName: 'parmcp-local' }).catch(
      (error: unknown) => error
    )

    expect(failure).toMatchObject({
      message:
        'Droid could not sign in to parmcp-local. Sign-in works only for remote (HTTP or SSE) servers that ask for it.',
      textKey: 'components.native-chat.droidHost.mcpSignInStdio',
      textParams: { serverName: 'parmcp-local' }
    })
    expect(open).not.toHaveBeenCalled()
    expect(connection.requests.map(({ method }) => method)).not.toContain(SUBMIT_CODE)
    expect(leaks(await whatTheHostWrote(h, logger, String(failure)))).toBe(false)
  })

  it('does not repeat a failure message that carries a link', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set(AUTHENTICATE, () => {
      throw new DroidRpcError(-32603, `Visit ${SIGN_IN_URL}`)
    })

    const failure = await run(SIGN_IN).catch((error: unknown) => error)

    expect(String(failure).includes('auth.example.invalid')).toBe(false)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({
      message: 'Droid could not sign in to remote.',
      textKey: 'components.native-chat.droidHost.mcpSignInFailed',
      textParams: { serverName: 'remote' }
    })
    expect(leaks(JSON.stringify(failure))).toBe(false)
  })

  it('has no opener on a host that cannot open a link, and says so without the link', async () => {
    const { h, connection, run, logger } = await sessionIn(GUEST_HOST, 'none')
    connection.replies.set(AUTHENTICATE, () => {
      challenge(connection)
      return new Promise(() => {})
    })

    const failure = await run(SIGN_IN).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      message: 'Orca could not open the sign-in link for remote on this host.',
      textKey: 'components.native-chat.droidHost.mcpLinkNotOpened',
      textParams: { serverName: 'remote' }
    })
    expect(leaks(await whatTheHostWrote(h, logger, failure))).toBe(false)
  })

  it.each([
    ['cancelled', 'Sign-in to remote was cancelled.', 'mcpSignInCancelled'],
    ['failed', 'Sign-in to remote did not finish.', 'mcpSignInIncomplete']
  ] as const)('words a %s sign-in from the outcome alone', async (outcome, words, key) => {
    const { h, connection, run, logger } = await sessionIn()
    raisesChallenge(connection, outcome)

    const failure = await run(SIGN_IN).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(DroidMcpSignInStopped)
    expect(failure).toBeInstanceOf(DroidHostTextError)
    expect(failure).toMatchObject({
      message: words,
      textKey: `components.native-chat.droidHost.${key}`,
      textParams: { serverName: 'remote' }
    })
    expect(leaks(await whatTheHostWrote(h, logger, failure))).toBe(false)
  })

  it('says the sign-in is still waiting when Droid does not answer in time', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set(AUTHENTICATE, () => {
      throw new DroidRequestTimeoutError(AUTHENTICATE)
    })

    await expect(run(SIGN_IN)).rejects.toMatchObject({
      message:
        'Sign-in to remote has not finished. Finish it in your browser, then run /mcp to check.',
      textKey: 'components.native-chat.droidHost.mcpSignInPending',
      textParams: { serverName: 'remote' }
    })
  })

  it('keys a sign-in Droid refused without returning its answer', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set(AUTHENTICATE, () => ({ success: false, message: SIGN_IN_URL }))

    const failure = await run(SIGN_IN).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      message: 'Droid did not sign in to remote.',
      textKey: 'components.native-chat.droidHost.mcpSignInRefused',
      textParams: { serverName: 'remote' }
    })
    expect(leaks(JSON.stringify(failure))).toBe(false)
  })

  it('does not tell the person to finish in the browser when Droid itself went away', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set(AUTHENTICATE, () => {
      throw new DroidConnectionClosedError()
    })

    const failure = await run(SIGN_IN).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(DroidConnectionClosedError)
    expect(String(failure)).not.toContain('browser')
  })

  it('does not blame the server type when Droid fails the sign-in of a remote server', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set(AUTHENTICATE, () => {
      throw new DroidRpcError(-32603, 'boom')
    })

    await expect(run(SIGN_IN)).rejects.toMatchObject({
      message: 'Droid could not sign in to remote.',
      textKey: 'components.native-chat.droidHost.mcpSignInFailed',
      textParams: { serverName: 'remote' }
    })
  })

  it('opens the same state again for a later sign-in, so a closed tab can be reopened', async () => {
    const { connection, run, open } = await sessionIn()
    connection.replies.set(AUTHENTICATE, () => {
      challenge(connection)
      return { success: true }
    })

    await run(SIGN_IN)
    await run(SIGN_IN)

    expect(open).toHaveBeenCalledTimes(2)
  })

  it('opens the same state again after the first open failed', async () => {
    const attempts = [false, true]
    const { connection, open } = await sessionIn('local', () => attempts.shift() ?? true)

    challenge(connection)
    await new Promise((resolve) => setTimeout(resolve, 0))
    challenge(connection)

    expect(open).toHaveBeenCalledTimes(2)
  })

  it('says Droid needs updating when it has no sign-in method', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set(AUTHENTICATE, () => {
      throw new DroidRpcError(-32601, 'Method not found')
    })

    await expect(run(SIGN_IN)).rejects.toThrow(
      'Signing in to an MCP server needs a newer Droid. Update Droid and try again.'
    )
  })
})
