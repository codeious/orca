import { afterEach, describe, expect, it } from 'vitest'
import { AgentSessionAcquisitionExitUnprovenError } from '../native-chat/agent-session-wire/acquisition/structured-agent-session-acquisition-errors'
import {
  closePiRpcAdapterFixtures,
  reportedEvent,
  restart,
  sessionId,
  setup
} from './rpc-session-adapter.test-fixture'

afterEach(closePiRpcAdapterFixtures)

describe('Pi RPC session ownership and delivery', () => {
  it('does not spawn a start cancelled while resolving its workspace', async () => {
    const h = await setup()
    await h.adapter.closeSession(sessionId)
    const launch = await h.resolveLaunch.mock.results[0]?.value
    const resolving = Promise.withResolvers<NonNullable<typeof launch>>()
    h.resolveLaunch.mockImplementationOnce(() => resolving.promise)
    const controller = new AbortController()
    const started = h.adapter.acquire({ ...h.input, fence: 8, signal: controller.signal })
    await Promise.resolve()
    controller.abort(new Error('Pi closed while starting'))
    await expect(started).rejects.toMatchObject({
      message: 'Pi closed while starting',
      reason: undefined
    })
    expect(h.connections).toHaveLength(1)
    await expect(h.adapter.acquire({ ...h.input, fence: 9 })).resolves.toMatchObject({
      process: { pid: 4123 }
    })
    resolving.resolve(launch!)
    await Promise.resolve()
    expect(h.connections).toHaveLength(2)
  })
})

describe('Pi child session lifecycle', () => {
  const message = (text: string) => ({
    sessionId,
    fence: 7,
    clientMessageId: text,
    executionOptions: {},
    body: {
      kind: 'message' as const,
      role: 'user' as const,
      blocks: [{ type: 'text' as const, text }]
    }
  })

  it('refuses a second acquire while the session still owns a live child', async () => {
    const h = await setup()

    await expect(h.adapter.acquire({ ...h.input, fence: 8 })).rejects.toThrow(
      'Pi session already owns a child'
    )
    expect(h.connections).toHaveLength(1)
  })

  it('refuses a concurrent acquire for the same session', async () => {
    const h = await setup()
    await h.adapter.closeSession(sessionId)
    const launch = await h.resolveLaunch.mock.results[0]?.value
    const resolving = Promise.withResolvers<NonNullable<typeof launch>>()
    h.resolveLaunch.mockImplementationOnce(() => resolving.promise)

    const first = h.adapter.acquire({ ...h.input, fence: 8 })
    await expect(h.adapter.acquire({ ...h.input, fence: 9 })).rejects.toThrow(
      'Pi session already owns a child'
    )
    resolving.resolve(launch!)

    await expect(first).resolves.toMatchObject({ process: { pid: 4123 } })
    expect(h.connections).toHaveLength(2)
  })

  it('will not start again over a failed start whose exit is not proven', async () => {
    const h = await setup()
    const failing = {
      onSpawned: async () => {
        throw new Error('spawn reporting failed')
      }
    }
    await expect(
      restart(h, (connection) => (connection.closeResult = { root: 'live', tree: null }), failing)
    ).rejects.toThrow()

    await expect(h.adapter.acquire({ ...h.input, fence: 9 })).rejects.toBeInstanceOf(
      AgentSessionAcquisitionExitUnprovenError
    )
    expect(h.connections).toHaveLength(2)
  })

  it('cancels only the open turn and interrupts the child for it', async () => {
    const h = await setup()
    await h.adapter.dispatch(message('hello'))
    h.connection.receive({ type: 'agent_start' })

    await expect(
      h.adapter.cancelTurn({ sessionId, fence: 7, turnId: 'an-earlier-turn' })
    ).resolves.toEqual({ cancelled: false })
    expect(h.connection.requests).not.toContain('abort')

    await expect(h.adapter.cancelTurn({ sessionId, fence: 7 })).resolves.toMatchObject({
      cancelled: true
    })
    expect(h.connection.requests).toContain('abort')
  })

  it('reports a requested close even when an unrequested close follows before exit', async () => {
    const h = await setup()
    h.connection.deferExit = true

    await h.adapter.closeSession(sessionId)
    await h.adapter.forceCloseSession(sessionId)
    h.connection.exit(new Error('child exited'))
    await h.adapter.drainObservedExits()

    expect(reportedEvent(h.lifecycle, 'ended')).toMatchObject({ cause: 'requested-close' })
  })

  it('publishes one end, with the first exit as its reason, however many exits arrive', async () => {
    const h = await setup()

    h.connection.exit(new Error('first exit'))
    h.connection.exit(new Error('second exit'))
    await h.adapter.drainObservedExits()

    const ends = h.lifecycle.mock.calls.filter(([event]) => event.type === 'ended')
    expect(ends).toHaveLength(1)
    expect(ends[0]?.[0]).toMatchObject({ cause: 'unexpected-exit', reason: 'first exit' })
  })
})
