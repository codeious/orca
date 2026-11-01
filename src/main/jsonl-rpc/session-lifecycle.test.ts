import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderProcessCloseResult } from '../provider-process/provider-process-close'
import { JsonlRpcSessionLifecycle } from './session-lifecycle'

const exited: ProviderProcessCloseResult = { root: 'exited', tree: 'exited' }
const live: ProviderProcessCloseResult = { root: 'live', tree: 'live' }

function rig(
  overrides: {
    drained?: () => Promise<void>
    close?: () => Promise<ProviderProcessCloseResult>
  } = {}
) {
  const calls: string[] = []
  const logger = { warn: vi.fn(), error: vi.fn() }
  const onLifecycle = vi.fn((_event: unknown) => {
    calls.push('lifecycle')
  })
  const onSettled = vi.fn()
  const lane = {
    finalize: vi.fn(() => calls.push('finalize')),
    apply: vi.fn(() => calls.push('apply')),
    flush: vi.fn(() => calls.push('flush')),
    drained: vi.fn(overrides.drained ?? (() => Promise.resolve())),
    dispose: vi.fn(() => calls.push('dispose'))
  }
  const connection = {
    close: vi.fn(
      overrides.close ??
        (async () => {
          calls.push('close')
          return exited
        })
    )
  }
  const lifecycle = new JsonlRpcSessionLifecycle({
    label: 'Toy',
    scope: 'toy',
    sessionId: 'session-1',
    fence: 7,
    generation: 'generation-1',
    lane,
    connection: () => connection,
    logger,
    onLifecycle,
    onSettled,
    endWork: () => calls.push('endWork'),
    beforeClose: () => calls.push('beforeClose')
  })
  return { lifecycle, lane, connection, logger, onLifecycle, onSettled, calls }
}

async function exit(lifecycle: JsonlRpcSessionLifecycle, error: Error): Promise<void> {
  lifecycle.observeExit(error)
  await lifecycle.drainObservedExit()
}

describe('a JSON-RPC child session lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs its before-close step, then closes the connection', async () => {
    const { lifecycle, calls } = rig()

    await lifecycle.close()

    expect(calls).toEqual(['beforeClose', 'close'])
  })

  it('rejects the close, rather than throwing, when its before-close step throws', async () => {
    const { lane, connection } = rig()
    const failing = new JsonlRpcSessionLifecycle({
      label: 'Toy',
      scope: 'toy',
      sessionId: 'session-1',
      fence: 7,
      generation: 'generation-1',
      lane,
      connection: () => connection,
      logger: { warn: vi.fn(), error: vi.fn() },
      onLifecycle: vi.fn(),
      onSettled: vi.fn(),
      endWork: vi.fn(),
      beforeClose: () => {
        throw new Error('dialogs stuck')
      }
    })

    const closing = failing.close()

    await expect(closing).rejects.toThrow('dialogs stuck')
    expect(connection.close).not.toHaveBeenCalled()
  })

  it('reports a requested close, and a later unrequested one does not take it back', async () => {
    const { lifecycle, onLifecycle } = rig()

    await lifecycle.close(true)
    await lifecycle.close(false)
    await exit(lifecycle, new Error('gone'))

    expect(onLifecycle).toHaveBeenCalledWith(expect.objectContaining({ cause: 'requested-close' }))
  })

  it('reports an exit nobody asked for as unexpected, with the exit error as its reason', async () => {
    const { lifecycle, onLifecycle } = rig()

    await lifecycle.close(false)
    await exit(lifecycle, new Error('child crashed'))

    expect(onLifecycle).toHaveBeenCalledWith({
      type: 'ended',
      sessionId: 'session-1',
      fence: 7,
      acquisitionGeneration: 'generation-1',
      observedAt: expect.any(Number),
      cause: 'unexpected-exit',
      reason: 'child crashed'
    })
  })

  it('ends the work, then the timeline, and only then publishes the end', async () => {
    const { lifecycle, lane, calls } = rig()

    await exit(lifecycle, new Error('gone'))

    expect(calls).toEqual(['endWork', 'finalize', 'apply', 'flush', 'lifecycle'])
    expect(lane.apply).toHaveBeenCalledWith([
      { type: 'session.ended', verdict: { state: 'interrupted', completedAt: expect.any(Number) } }
    ])
  })

  it('publishes one end however many exits it observes', async () => {
    const { lifecycle, onLifecycle } = rig()

    lifecycle.observeExit(new Error('first'))
    lifecycle.observeExit(new Error('second'))
    await vi.runAllTimersAsync()

    expect(onLifecycle).toHaveBeenCalledTimes(1)
    expect(onLifecycle).toHaveBeenCalledWith(expect.objectContaining({ reason: 'first' }))
  })

  it('gives the first failure as the reason, and closes the child without asking for it', async () => {
    const { lifecycle, logger, onLifecycle } = rig()

    lifecycle.fail(new Error('first'))
    lifecycle.fail(new Error('second'))
    await vi.runAllTimersAsync()
    await exit(lifecycle, new Error('exit'))

    expect(logger.error).toHaveBeenCalledWith('Toy RPC session failed', {
      scope: 'toy-rpc',
      sessionId: 'session-1',
      error: expect.objectContaining({ message: 'first' })
    })
    expect(onLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'unexpected-exit', reason: 'first' })
    )
  })

  it('warns when a failed child is not proven gone', async () => {
    const { lifecycle, logger } = rig({ close: async () => live })

    lifecycle.fail(new Error('boom'))
    await vi.runAllTimersAsync()

    expect(logger.warn).toHaveBeenCalledWith('Toy process exit is unverifiable', {
      scope: 'toy-stop',
      sessionId: 'session-1'
    })
  })

  it('does not warn when a failed child is proven gone', async () => {
    const { lifecycle, logger } = rig()

    lifecycle.fail(new Error('boom'))
    await vi.runAllTimersAsync()

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs a close that throws instead of rejecting', async () => {
    const cause = new Error('kill failed')
    const { lifecycle, logger } = rig({ close: () => Promise.reject(cause) })

    lifecycle.fail(new Error('boom'))
    await vi.runAllTimersAsync()

    expect(logger.error).toHaveBeenCalledWith('Toy process cleanup failed', {
      scope: 'toy-stop',
      sessionId: 'session-1',
      error: cause
    })
  })

  it('publishes the end after two seconds when the timeline has not drained, and says so', async () => {
    const { lifecycle, logger, onLifecycle } = rig({ drained: () => new Promise(() => undefined) })

    lifecycle.observeExit(new Error('gone'))
    await vi.advanceTimersByTimeAsync(1_999)
    expect(onLifecycle).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await lifecycle.drainObservedExit()

    expect(onLifecycle).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'Toy final timeline did not drain before exit publication',
      { scope: 'toy-exit-drain', sessionId: 'session-1' }
    )
  })

  it('logs an end it could not publish, and still settles the drain', async () => {
    const { lifecycle, logger, onLifecycle } = rig()
    const cause = new Error('journal down')
    onLifecycle.mockImplementationOnce(() => {
      throw cause
    })

    lifecycle.observeExit(new Error('gone'))
    await expect(lifecycle.drainObservedExit()).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith('Toy exit publication failed', {
      scope: 'toy-exit',
      sessionId: 'session-1',
      error: cause
    })
  })

  it('retires after the end is published and the timeline drained, then disposes the timeline', async () => {
    const { lifecycle, calls } = rig()

    const retired = lifecycle.retire()
    lifecycle.observeExit(new Error('gone'))
    await retired

    expect(calls.slice(-2)).toEqual(['lifecycle', 'dispose'])
  })

  it('does not dispose the timeline before the end is published', async () => {
    const { lifecycle, lane } = rig()

    void lifecycle.retire()
    await vi.runAllTimersAsync()

    expect(lane.dispose).not.toHaveBeenCalled()
  })

  it('retires at once when the end was already published', async () => {
    const { lifecycle, lane } = rig()
    await exit(lifecycle, new Error('gone'))

    await lifecycle.retire()

    expect(lane.dispose).toHaveBeenCalledTimes(1)
  })

  it('settles a dispatch under this session and fence', () => {
    const { lifecycle, onSettled } = rig()
    const outcome = {
      state: 'accepted',
      providerIdentity: { provider: 'orca', clientMessageId: 'message-1' }
    } as const

    lifecycle.settle('message-1', outcome)

    expect(onSettled).toHaveBeenCalledWith({
      sessionId: 'session-1',
      clientMessageId: 'message-1',
      fence: 7,
      outcome
    })
  })
})
