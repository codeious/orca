import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter
} from './droid-adapter-rig.test-support'

afterEach(runDroidRigCleanups)
afterEach(() => vi.useRealTimers())

describe('Droid compression summary', () => {
  it('does not claim an old summary when the baseline read timed out', async () => {
    vi.useFakeTimers()
    const readCompactionSummary = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ id: 'old', text: 'Previous compaction, not this one.' })
    const h = await setupDroidAdapter(
      {},
      (child) => {
        child.replies.set('droid.compact_session', () => ({
          newSessionId: 'droid-session-1',
          removedCount: 7
        }))
      },
      { readCompactionSummary }
    )
    await h.start()
    const pending = h.adapter.droidCommand({
      sessionId: DROID_RIG_SESSION,
      fence: 7,
      command: { name: 'compress' }
    })
    await vi.advanceTimersByTimeAsync(1_201)
    await pending
    const rows = await h.rig.rows()
    expect(rows[0]?.body).not.toHaveProperty('summaryText')
    expect(rows[0]?.body).toMatchObject({ textParams: { removedCount: 7 } })
  })

  it('reads a new compact id on the same SSH execution host that launched the child', async () => {
    const readCompactionSummary = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'summary-2', text: 'The earlier exchange was ok.' })
    const h = await setupDroidAdapter(
      {
        cwd: '/guest/workspace',
        env: { HOME: '/guest/account', PATH: '/guest/bin' }
      },
      (child) => {
        child.replies.set('droid.compact_session', () => ({
          newSessionId: 'new-droid-id',
          removedCount: 7
        }))
      },
      { readCompactionSummary },
      'runtime:guest'
    )
    const { connection } = await h.start()

    expect(
      await h.adapter.droidCommand({
        sessionId: DROID_RIG_SESSION,
        fence: 7,
        command: { name: 'compress' }
      })
    ).toEqual({ name: 'compress', removedCount: 7, newSessionId: 'new-droid-id' })
    expect(
      readCompactionSummary.mock.calls.map(([launch, id]) => ({
        home: launch.env.HOME,
        cwd: launch.cwd,
        id
      }))
    ).toEqual([
      { home: '/guest/account', cwd: '/guest/workspace', id: 'droid-session-1' },
      { home: '/guest/account', cwd: '/guest/workspace', id: 'new-droid-id' }
    ])
    expect((await h.rig.rows()).map((row) => row.body)).toEqual([
      expect.objectContaining({
        summaryText: 'The earlier exchange was ok.'
      })
    ])
    expect(connection.closed).toBe(false)
  })

  it.each(['missing', 'older', 'unknown', 'unreadable', 'stale'] as const)(
    'keeps the count boundary and the chat open for a %s summary',
    async (kind) => {
      vi.useFakeTimers()
      const readCompactionSummary = vi.fn(async () => {
        if (kind === 'unreadable') {
          throw new Error('File unavailable')
        }
        return kind === 'stale' ? { id: 'old', text: 'An old summary, not this compact.' } : null
      })
      const h = await setupDroidAdapter(
        {},
        (child) => {
          child.replies.set('droid.compact_session', () => ({ removedCount: 7 }))
        },
        { readCompactionSummary }
      )
      const { connection } = await h.start()
      const pending = h.adapter.droidCommand({
        sessionId: DROID_RIG_SESSION,
        fence: 7,
        command: { name: 'compress' }
      })
      await vi.advanceTimersByTimeAsync(1_201)
      await expect(pending).resolves.toEqual({
        name: 'compress',
        removedCount: 7,
        newSessionId: null
      })
      expect((await h.rig.rows()).map((row) => row.body)).toEqual([
        {
          kind: 'status',
          text: 'Conversation compressed. 7 earlier messages were summarized to free up context.',
          textKey: 'components.native-chat.droidHost.compressMany',
          textParams: { removedCount: 7 }
        }
      ])
      expect(connection.closed).toBe(false)
      expect(connection.requests.some((row) => row.method === 'droid.add_user_message')).toBe(false)
    }
  )

  it('bounds a reader that never answers, then still allows the next command', async () => {
    vi.useFakeTimers()
    const h = await setupDroidAdapter(
      {},
      (child) => {
        child.replies.set('droid.compact_session', () => ({ removedCount: 1 }))
      },
      { readCompactionSummary: () => new Promise(() => {}) }
    )
    await h.start()
    const pending = h.adapter.droidCommand({
      sessionId: DROID_RIG_SESSION,
      fence: 7,
      command: { name: 'compress' }
    })
    await vi.advanceTimersByTimeAsync(1_201)
    await expect(pending).resolves.toEqual({
      name: 'compress',
      removedCount: 1,
      newSessionId: null
    })
    await expect(
      h.adapter.droidCommand({
        sessionId: DROID_RIG_SESSION,
        fence: 7,
        command: { name: 'credits' }
      })
    ).resolves.toEqual({ name: 'credits', factoryCredits: null })
  })

  it('journals Droid’s summary beside the catalog label without sending a user message', async () => {
    const readCompactionSummary = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({
      id: 'summary-1',
      text: 'The user asked for **ok**. The assistant replied ok.'
    })
    const deps = { readCompactionSummary, logger: { warn: vi.fn(), error: vi.fn() } }
    const h = await setupDroidAdapter(
      {},
      (child) => {
        child.replies.set('droid.compact_session', () => ({
          newSessionId: 'droid-session-1',
          removedCount: 7
        }))
      },
      deps
    )
    const { connection } = await h.start()

    expect(
      await h.adapter.droidCommand({
        sessionId: DROID_RIG_SESSION,
        fence: 7,
        command: { name: 'compress' }
      })
    ).toEqual({ name: 'compress', removedCount: 7, newSessionId: null })
    expect((await h.rig.rows()).map((row) => row.body)).toEqual([
      expect.objectContaining({
        kind: 'status',
        textKey: 'components.native-chat.droidHost.compressMany',
        textParams: { removedCount: 7 },
        summaryText: 'The user asked for **ok**. The assistant replied ok.'
      })
    ])
    expect(connection.requests.some((row) => row.method === 'droid.add_user_message')).toBe(false)
    expect(connection.closed).toBe(false)
  })
})
