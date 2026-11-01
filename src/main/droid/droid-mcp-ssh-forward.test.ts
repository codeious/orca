import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSubscribeEvent } from '../../shared/agent-session-wire'
import type { DroidMcpAction } from '../../shared/droid-host-command'
import {
  MCP_SIGN_IN_OPEN_ACK_TIMEOUT_MS,
  type McpSignInCaller
} from '../native-chat/agent-session-wire/agent-session-mcp-sign-in-forwarding'
import { AgentSessionSubscribers } from '../native-chat/agent-session-wire/structured-agent-session-subscribers'
import { bindMcpSignInCaller } from '../native-chat/agent-session-wire/structured-agent-session-droid-command'
import {
  DROID_RIG_SESSION as SESSION,
  runDroidRigCleanups,
  setupDroidAdapter
} from './droid-adapter-rig.test-support'

afterEach(async () => {
  vi.useRealTimers()
  await runDroidRigCleanups()
})

const HOST = 'runtime:5c2e9a7e-1111-4222-8333-944455556666'
const AUTH = 'droid.authenticate_mcp_server'
const SIGN_IN = { name: 'mcp', action: { kind: 'sign-in', serverName: 'remote' } } as const
const CALLER: McpSignInCaller = { callerKey: 'desktop-a', connectionId: 'initiator' }

async function rig({ autoChallenge = true } = {}) {
  const subscribers = new AgentSessionSubscribers()
  const logger = { warn: vi.fn(), error: vi.fn() }
  const h = await setupDroidAdapter(
    { cwd: '/work/probe' },
    undefined,
    {
      logger,
      forwardMcpSignIn: (sessionId, url, serverName) =>
        subscribers.mcpSignIn.open(sessionId, url, serverName)
    },
    HOST
  )
  const { connection } = await h.start()
  connection.replies.set('droid.list_mcp_servers', () => ({
    servers: ['remote', 'other'].map((name) => ({
      name,
      status: 'disconnected',
      serverType: 'http',
      requiresAuth: true
    }))
  }))
  const link = new URL(
    '/authorize?code=never-written&state=only-in-memory',
    'https://fake.invalid'
  ).toString()
  const challenge = (serverName = 'remote') =>
    connection.notify({
      type: 'mcp_auth_required',
      serverName,
      authUrl: link,
      state: 'one',
      message: `Open ${link} to sign in`
    })
  const finishAuth: (() => void)[] = []
  connection.replies.set(AUTH, () => {
    const answer = new Promise((resolve) => {
      finishAuth.push(() => resolve({ success: true }))
    })
    if (autoChallenge) {
      challenge()
    }
    return answer
  })
  const runAction = (action: DroidMcpAction) =>
    h.adapter.droidCommand({
      sessionId: SESSION,
      fence: 7,
      command: { name: 'mcp', action }
    })
  const runCommand = bindMcpSignInCaller(subscribers.mcpSignIn, (sessionId, command) => {
    if (command.name !== 'mcp') {
      throw new Error('This peer accepts only MCP commands')
    }
    return h.adapter.droidCommand({ sessionId, fence: 7, command })
  })
  const run = (caller: McpSignInCaller = CALLER) => runCommand(SESSION, SIGN_IN, caller)
  const open = vi.fn()
  let requestId = ''
  let respond: boolean | undefined = true
  let emitFailure = false
  const other: AgentSessionSubscribeEvent[] = []
  const subscribe = (id: string, callerKey?: string) =>
    subscribers.open({
      id,
      sessionId: SESSION,
      journal: h.rig.journal,
      fence: 7,
      ...(callerKey ? { mcpSignInCaller: { callerKey, connectionId: id } } : {}),
      emit: (event) => {
        if (id !== 'initiator') {
          other.push(event)
          return
        }
        if (event.type !== 'batch' || !event.mcpSignInOpen) {
          return
        }
        requestId = event.mcpSignInOpen.requestId
        if (emitFailure) {
          throw new Error(`Transport closed while opening ${link}`)
        }
        open()
        if (respond !== undefined) {
          subscribers.mcpSignIn.acknowledge(SESSION, requestId, id, 'desktop-a', respond)
        }
      }
    })
  const writtenIsSafe = async (answer: unknown) => {
    const written = JSON.stringify([
      await h.rig.rows(),
      logger.warn.mock.calls,
      logger.error.mock.calls,
      answer,
      other,
      ...(answer instanceof Error ? [answer.message, answer.stack] : [])
    ])
    return !['fake.invalid', 'never-written', 'only-in-memory', 'authUrl'].some((part) =>
      written.includes(part)
    )
  }
  const acknowledge = (
    opened: boolean,
    overrides: {
      sessionId?: string
      requestId?: string
      connectionId?: string
      callerKey?: string
    } = {}
  ) =>
    subscribers.mcpSignIn.acknowledge(
      overrides.sessionId ?? SESSION,
      overrides.requestId ?? requestId,
      overrides.connectionId ?? CALLER.connectionId,
      overrides.callerKey ?? CALLER.callerKey,
      opened
    )
  return {
    subscribers,
    h,
    connection,
    run,
    runCommand,
    runAction,
    open,
    subscribe,
    challenge,
    acknowledge,
    setResponse: (value: boolean | undefined) => {
      respond = value
    },
    setEmitFailure: (value: boolean) => {
      emitFailure = value
    },
    requestId: () => requestId,
    finishAuth: () => finishAuth.splice(0).forEach((finish) => finish()),
    finishOneAuth: () => finishAuth.shift()?.(),
    writtenIsSafe
  }
}

async function expectPrivateAnswer(r: Awaited<ReturnType<typeof rig>>, answer: unknown) {
  expect(await r.writtenIsSafe(answer)).toBe(true)
  expect(r.connection.requests.some(({ method }) => method === 'droid.submit_mcp_auth_code')).toBe(
    false
  )
}

async function expectFallbackAndRetry(r: Awaited<ReturnType<typeof rig>>, failure: unknown) {
  expect(failure).toMatchObject({ textKey: 'components.native-chat.droidHost.mcpLinkNotOpened' })
  expect(r.acknowledge(false)).toBe(false)
  expect(r.acknowledge(true)).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
  await expectPrivateAnswer(r, failure)
  // A stopped browser wait does not cancel authentication on the peer.
  const blocked = await r.run().catch((error: unknown) => error)
  expect(blocked).toMatchObject({ textKey: 'components.native-chat.droidHost.mcpSignInIncomplete' })
  r.finishAuth()
  await vi.advanceTimersByTimeAsync(0)
  const previousRequestId = r.requestId()
  r.setResponse(true)
  r.setEmitFailure(false)
  r.subscribe('initiator', CALLER.callerKey)
  const pending = r.run()
  await vi.advanceTimersByTimeAsync(0)
  expect(r.requestId() !== previousRequestId).toBe(true)
  r.finishAuth()
  const answer = await pending
  expect(answer).toMatchObject({ name: 'mcp', changed: { kind: 'signed-in' } })
  expect(r.acknowledge(false)).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
  expect(r.connection.requests.filter(({ method }) => method === AUTH)).toHaveLength(2)
  await expectPrivateAnswer(r, answer)
}

describe('MCP sign-in forwarded from the session execution host', () => {
  it('does not let an old authentication reply release a newer retired attempt', async () => {
    const r = await rig()
    r.subscribe('initiator', CALLER.callerKey)
    r.setResponse(false)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await r.run().catch(() => {})
    r.connection.notify({ type: 'mcp_auth_completed', serverName: 'remote', outcome: 'cancelled' })
    await r.run().catch(() => {})
    r.finishOneAuth()
    await vi.advanceTimersByTimeAsync(0)
    let refused = false
    const third = r.run().catch((error: unknown) => {
      refused = true
      return error
    })
    await vi.advanceTimersByTimeAsync(0)
    const refusedBeforeCleanup = refused
    r.finishAuth()
    const answer = await third
    expect(refusedBeforeCleanup).toBe(true)
    expect(answer).toMatchObject({
      textKey: 'components.native-chat.droidHost.mcpSignInIncomplete'
    })
    expect(r.connection.requests.filter(({ method }) => method === AUTH)).toHaveLength(2)
    await expectPrivateAnswer(r, answer)
  })

  it('never forwards a late challenge to a different caller after the original browser wait times out', async () => {
    const r = await rig()
    r.subscribe('initiator', CALLER.callerKey)
    r.setResponse(undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const first = r.run().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await first).toMatchObject({
      textKey: 'components.native-chat.droidHost.mcpLinkNotOpened'
    })
    r.subscribe('later-caller', 'desktop-b')
    const second = r
      .run({ callerKey: 'desktop-b', connectionId: 'later-caller' })
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    r.challenge()
    await vi.advanceTimersByTimeAsync(0)
    const answer = await second
    expect(answer).toMatchObject({
      textKey: 'components.native-chat.droidHost.mcpSignInIncomplete'
    })
    expect(r.connection.requests.filter(({ method }) => method === AUTH)).toHaveLength(1)
    expect(r.open).toHaveBeenCalledOnce()
    expect(r.acknowledge(true)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    await expectPrivateAnswer(r, answer)
  })

  it.each([
    ['absent caller', undefined],
    ['caller without open support', { callerKey: 'unsupported', connectionId: 'unsupported' }]
  ])(
    'rejects an overlapping sign-in from %s before authentication starts',
    async (_label, caller) => {
      const r = await rig({ autoChallenge: false })
      r.subscribe('initiator', CALLER.callerKey)
      r.setResponse(undefined)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const first = r.run().catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(0)
      let refused = false
      const second = r
        .runCommand(
          SESSION,
          { name: 'mcp', action: { kind: 'sign-in', serverName: 'other' } },
          caller
        )
        .catch((error: unknown) => {
          refused = true
          return error
        })
      await vi.advanceTimersByTimeAsync(0)
      const refusedBeforeChallenge = refused
      const onlyFirstAuthenticated =
        r.connection.requests.filter(({ method }) => method === AUTH).length === 1
      const noPendingOpen = r.requestId() === '' && vi.getTimerCount() === 0
      r.challenge()
      await vi.advanceTimersByTimeAsync(0)
      const firstCanAcknowledge = r.acknowledge(true)
      r.finishAuth()
      const [answer, failure] = await Promise.all([first, second])
      expect(refusedBeforeChallenge).toBe(true)
      expect(onlyFirstAuthenticated).toBe(true)
      expect(noPendingOpen).toBe(true)
      expect(firstCanAcknowledge).toBe(true)
      expect(r.open).toHaveBeenCalledOnce()
      expect(answer).toMatchObject({ name: 'mcp', changed: { kind: 'signed-in' } })
      expect(failure).toMatchObject({
        textKey: 'components.native-chat.droidHost.mcpSignInIncomplete'
      })
      expect(vi.getTimerCount()).toBe(0)
      await expectPrivateAnswer(r, answer)
      await expectPrivateAnswer(r, failure)
    }
  )

  it('never delivers another server challenge or replaces the intended pending open', async () => {
    const r = await rig({ autoChallenge: false })
    r.subscribe('initiator', CALLER.callerKey)
    r.setResponse(undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = r.run().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    r.challenge('other')
    await vi.advanceTimersByTimeAsync(0)
    const wrongChallengeNotDelivered = r.open.mock.calls.length === 0
    const wrongChallengeHasNoPendingOpen = r.requestId() === '' && vi.getTimerCount() === 0
    r.challenge()
    await vi.advanceTimersByTimeAsync(0)
    const intendedRequestId = r.requestId()
    r.challenge('other')
    await vi.advanceTimersByTimeAsync(0)
    const intendedRequestUnchanged = r.requestId() === intendedRequestId
    const intendedOpenAcknowledged = r.acknowledge(true)
    r.finishAuth()
    const answer = await pending
    expect(wrongChallengeNotDelivered).toBe(true)
    expect(wrongChallengeHasNoPendingOpen).toBe(true)
    expect(intendedRequestUnchanged).toBe(true)
    expect(intendedOpenAcknowledged).toBe(true)
    expect(r.open).toHaveBeenCalledOnce()
    expect(answer).toMatchObject({ name: 'mcp', changed: { kind: 'signed-in' } })
    expect(vi.getTimerCount()).toBe(0)
    await expectPrivateAnswer(r, answer)
  })

  it('still awaits the desktop verdict when authentication answers before the open', async () => {
    const r = await rig()
    r.subscribe('initiator', CALLER.callerKey)
    r.setResponse(undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let settled = false
    const pending = r
      .run()
      .catch((error: unknown) => error)
      .then((answer) => {
        settled = true
        return answer
      })
    await vi.advanceTimersByTimeAsync(0)
    r.finishAuth()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    expect(r.acknowledge(false)).toBe(true)
    const answer = await pending
    expect(answer).toMatchObject({ textKey: 'components.native-chat.droidHost.mcpLinkNotOpened' })
    expect(r.acknowledge(true)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    await expectPrivateAnswer(r, answer)
  })

  it('delivers once to the initiating desktop, not a second subscriber, and uses its true acknowledgment', async () => {
    const r = await rig()
    r.subscribe('initiator', 'desktop-a')
    r.subscribe('second-desktop', 'desktop-b')
    r.subscribe('mobile')
    const pending = r.run().catch((error: unknown) => error)
    // The peer can repeat its challenge before authentication completes.
    await vi.waitFor(() => expect(r.open).toHaveBeenCalledOnce())
    r.challenge()
    r.finishAuth()
    const answer = await pending
    expect(r.open).toHaveBeenCalledOnce()
    expect(answer).toMatchObject({ name: 'mcp', changed: { kind: 'signed-in' } })
    expect(
      JSON.stringify(await r.h.rig.rows()).includes(
        'components.native-chat.droidHost.mcpLinkOpened'
      )
    ).toBe(true)
    await expectPrivateAnswer(r, answer)
    expect(r.acknowledge(true)).toBe(false)
    expect(r.h.input.identity.hostId).toBe(HOST)
  })

  it('does not select an earlier subscriber that shares the caller key on another connection', async () => {
    const r = await rig()
    r.subscribe('replaced-connection', CALLER.callerKey)
    r.subscribe('initiator', CALLER.callerKey)
    const pending = r.run().catch((error: unknown) => error)
    await vi.waitFor(() => expect(r.open).toHaveBeenCalledOnce())
    r.finishAuth()
    const answer = await pending
    expect(answer).toMatchObject({ name: 'mcp', changed: { kind: 'signed-in' } })
    await expectPrivateAnswer(r, answer)
  })

  it('ends a refused open without pending acknowledgment and permits another sign-in', async () => {
    const r = await rig()
    r.subscribe('initiator', CALLER.callerKey)
    r.setResponse(false)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const failure = await r.run().catch((error: unknown) => error)
    expect(r.open).toHaveBeenCalledOnce()
    await expectFallbackAndRetry(r, failure)
  })

  it('waits at most 30 seconds for an acknowledgment, then falls back and permits another sign-in', async () => {
    const r = await rig()
    r.subscribe('initiator', CALLER.callerKey)
    r.setResponse(undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let settled = false
    const pending = r
      .run()
      .catch((error: unknown) => error)
      .then((answer) => {
        settled = true
        return answer
      })
    await vi.advanceTimersByTimeAsync(0)
    expect(r.open).toHaveBeenCalledOnce()
    expect(MCP_SIGN_IN_OPEN_ACK_TIMEOUT_MS).toBe(30_000)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    await expectFallbackAndRetry(r, await pending)
  })

  it('disposes a disconnected subscriber and ends its pending open without waiting for timeout', async () => {
    const r = await rig()
    const disconnect = r.subscribe('initiator', CALLER.callerKey)
    r.setResponse(undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = r.run().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(r.open).toHaveBeenCalledOnce()
    disconnect()
    disconnect()
    expect(r.subscribers.subscriberCountForTests(SESSION)).toBe(0)
    await expectFallbackAndRetry(r, await pending)
  })

  it('ends the pending open when the chat tab closes and permits a later sign-in', async () => {
    const r = await rig()
    r.subscribe('initiator', CALLER.callerKey)
    r.setResponse(undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = r.run().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(r.open).toHaveBeenCalledOnce()
    r.subscribers.mcpSignIn.close(SESSION)
    r.subscribers.mcpSignIn.close(SESSION)
    await expectFallbackAndRetry(r, await pending)
  })

  it('does not use another desktop when the caller has not registered open support', async () => {
    const r = await rig()
    r.subscribe('initiator')
    r.subscribe('second-desktop', CALLER.callerKey)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const failure = await r.run().catch((error: unknown) => error)
    expect(r.open).not.toHaveBeenCalled()
    await expectFallbackAndRetry(r, failure)
  })

  it('ends a failed subscriber delivery without leaking its thrown link or leaving a pending open', async () => {
    const r = await rig()
    r.subscribe('initiator', CALLER.callerKey)
    r.setEmitFailure(true)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const failure = await r.run().catch((error: unknown) => error)
    expect(r.subscribers.subscriberCountForTests(SESSION)).toBe(0)
    await expectFallbackAndRetry(r, failure)
  })

  it.each([
    ['another connection', { connectionId: 'different-connection' }],
    ['another caller', { callerKey: 'different-caller' }],
    ['another session', { sessionId: 'different-session' }],
    ['an unknown request', { requestId: 'different-request' }]
  ])(
    'rejects a spoofed acknowledgment from %s without consuming the real pending open',
    async (_label, identity) => {
      const r = await rig()
      r.subscribe('initiator', CALLER.callerKey)
      r.setResponse(undefined)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const pending = r.run()
      await vi.advanceTimersByTimeAsync(0)
      expect(r.open).toHaveBeenCalledOnce()
      expect(r.acknowledge(true, identity)).toBe(false)
      expect(r.acknowledge(false, identity)).toBe(false)
      expect(vi.getTimerCount()).toBe(1)
      expect(r.acknowledge(true)).toBe(true)
      r.finishAuth()
      const answer = await pending
      expect(answer).toMatchObject({ name: 'mcp', changed: { kind: 'signed-in' } })
      expect(vi.getTimerCount()).toBe(0)
      await expectPrivateAnswer(r, answer)
    }
  )

  it('routes add and toggle only to the runtime session peer without opening a browser', async () => {
    const r = await rig()
    let disabled = false
    let added = false
    r.connection.replies.set('droid.list_mcp_servers', () => ({
      servers: added
        ? [
            {
              name: 'runtime-local',
              status: disabled ? 'disabled' : 'connecting',
              serverType: 'stdio'
            }
          ]
        : []
    }))
    r.connection.replies.set('droid.add_mcp_server', () => {
      added = true
      return { success: true }
    })
    r.connection.replies.set('droid.toggle_mcp_server', () => {
      disabled = true
      return { success: true }
    })
    const addedAnswer = await r.runAction({
      kind: 'add',
      serverName: 'runtime-local',
      server: { type: 'stdio', command: 'runtime-mcp', args: ['--quiet'] }
    })
    const toggledAnswer = await r.runAction({
      kind: 'toggle',
      serverName: 'runtime-local',
      enabled: false
    })
    expect(
      r.connection.requests
        .filter(({ method }) => method.endsWith('_mcp_server'))
        .map(({ method, params }) => [method, params])
    ).toEqual([
      [
        'droid.add_mcp_server',
        { name: 'runtime-local', type: 'stdio', command: 'runtime-mcp', args: ['--quiet'] }
      ],
      [
        'droid.toggle_mcp_server',
        { serverName: 'runtime-local', enabled: false, settingsLevel: 'user' }
      ]
    ])
    expect(r.h.input.identity.hostId).toBe(HOST)
    expect(r.h.connections).toHaveLength(1)
    expect(r.open).not.toHaveBeenCalled()
    await expectPrivateAnswer(r, [addedAnswer, toggledAnswer])
  })
})
