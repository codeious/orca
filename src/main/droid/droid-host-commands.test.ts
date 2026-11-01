import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DroidHostCommand } from '../../shared/droid-host-command'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type FakeConnection
} from './droid-adapter-rig.test-support'
import { DROID_CONTEXT_BREAKDOWN, droidTokenUsageChanged } from './droid-context-usage.test-support'
import { readDroidExchanges, replayExchange } from './droid-recording.test-support'
import { DroidRpcError } from './droid-rpc-errors'

afterEach(runDroidRigCleanups)

async function startedSession(droidSessionId?: string) {
  const h = await setupDroidAdapter(
    {},
    droidSessionId === undefined
      ? undefined
      : (child) =>
          child.replies.set('droid.initialize_session', () => ({ sessionId: droidSessionId }))
  )
  const { connection } = await h.start()
  const run = (command: DroidHostCommand) =>
    h.adapter.droidCommand({ sessionId: DROID_RIG_SESSION, fence: 7, command })
  return { h, connection, run }
}

const methods = (connection: FakeConnection) => connection.requests.map(({ method }) => method)

describe('Droid /context', () => {
  it('reads the breakdown Droid reports and answers with the report the ring holds', async () => {
    const { connection, run } = await startedSession()
    connection.replies.set('droid.get_context_breakdown', () => DROID_CONTEXT_BREAKDOWN)

    expect(await run({ name: 'context' })).toEqual({
      name: 'context',
      report: {
        model: 'claude-haiku-5-5',
        usedTokens: 10501,
        windowTokens: 250000,
        percentage: 4,
        categories: DROID_CONTEXT_BREAKDOWN.categories.map(({ name, tokens }) => ({
          name,
          tokens
        })),
        capturedAt: expect.any(Number)
      }
    })
    expect(methods(connection)).toContain('droid.get_context_breakdown')
  })

  it('leaves out a category Droid reports with no name, which the ring cannot show', async () => {
    const { connection, run } = await startedSession()
    connection.replies.set('droid.get_context_breakdown', () => ({
      ...DROID_CONTEXT_BREAKDOWN,
      categories: [{ name: '', tokens: 7 }, ...DROID_CONTEXT_BREAKDOWN.categories]
    }))

    const answer = await run({ name: 'context' })

    expect(answer.name === 'context' ? answer.report?.categories : undefined).toEqual(
      DROID_CONTEXT_BREAKDOWN.categories.map(({ name, tokens }) => ({ name, tokens }))
    )
  })

  it('says Droid needs updating when it has no breakdown method', async () => {
    const { connection, run } = await startedSession()
    connection.replies.set('droid.get_context_breakdown', () => {
      throw new DroidRpcError(-32601, 'Method not found')
    })

    await expect(run({ name: 'context' })).rejects.toThrow(
      'Showing context usage needs a newer Droid. Update Droid and try again.'
    )
  })
})

describe('Droid /compress', () => {
  const compacting = async (reply: unknown, instructions?: string) => {
    const { h, connection, run } = await startedSession()
    connection.replies.set('droid.compact_session', () => reply)
    const result = await run({ name: 'compress', ...(instructions ? { instructions } : {}) })
    const statuses = (await h.rig.rows()).flatMap(({ body }) =>
      body.kind === 'status' ? [body.text] : []
    )
    return { connection, result, statuses }
  }
  const compactCalls = (connection: FakeConnection) =>
    connection.requests.filter(({ method }) => method === 'droid.compact_session')

  it('asks Droid to compact with the instruction, and sends no message', async () => {
    const { connection } = await compacting(
      { newSessionId: 'droid-session-1', removedCount: 5 },
      'remember the word ok'
    )

    expect(compactCalls(connection).map(({ params }) => params)).toEqual([
      { customInstructions: 'remember the word ok' }
    ])
    expect(methods(connection)).not.toContain('droid.add_user_message')
  })

  it('names no instruction when none is given', async () => {
    const { connection } = await compacting({ newSessionId: 'droid-session-1', removedCount: 5 })

    expect(compactCalls(connection).map(({ params }) => params)).toEqual([{}])
  })

  describe('as Droid 0.251.0 answered them', () => {
    // The session the recording was made on; a plain compaction answers with this same id.
    const RECORDED_SESSION = '00000000-0000-4000-8000-000000000001'
    const recordedCompress = async (recordedRequest: 'r1' | 'r2') => {
      const exchanges = await readDroidExchanges('compact-session')
      const { h, connection, run } = await startedSession(RECORDED_SESSION)
      connection.replies.set(
        'droid.compact_session',
        replayExchange(connection, exchanges, recordedRequest)
      )
      const result = await run({ name: 'compress' })
      const statuses = (await h.rig.rows()).flatMap(({ body }) =>
        body.kind === 'status' ? [body.text] : []
      )
      return { result, statuses, run }
    }

    it('keeps the chat on its session when Droid compacts it in place, and says what was done', async () => {
      const { result, statuses } = await recordedCompress('r1')

      expect(result).toEqual({ name: 'compress', removedCount: 5, newSessionId: null })
      expect(statuses).toEqual([
        'Conversation compressed. 5 earlier messages were summarized to free up context.'
      ])
    })

    it('counts the credits the plain compaction billed', async () => {
      const { run } = await recordedCompress('r1')

      expect(await run({ name: 'credits' })).toEqual({ name: 'credits', factoryCredits: 505 })
    })

    it('hands the chat the session a handoff compaction moved the summary to', async () => {
      const { result, statuses } = await recordedCompress('r2')

      expect(result).toEqual({
        name: 'compress',
        removedCount: 5,
        newSessionId: '00000000-0000-4000-8000-000000000009'
      })
      expect(statuses).toEqual([
        'Conversation compressed into a new Droid session. The earlier session stays in Session History.'
      ])
    })
  })

  it('keeps the chat on its session when Droid names no new one', async () => {
    const { result, statuses } = await compacting({ removedCount: 1 })

    expect(result).toEqual({ name: 'compress', removedCount: 1, newSessionId: null })
    expect(statuses).toEqual([
      'Conversation compressed. 1 earlier message was summarized to free up context.'
    ])
  })

  it('hands the chat a new session even when Droid reports no count of what it removed', async () => {
    const { result, statuses } = await compacting({ newSessionId: 'droid-session-2' })

    expect(result).toEqual({
      name: 'compress',
      removedCount: null,
      newSessionId: 'droid-session-2'
    })
    expect(statuses).toEqual([
      'Conversation compressed into a new Droid session. The earlier session stays in Session History.'
    ])
  })

  describe('the context ring', () => {
    const breakdownReads = (connection: FakeConnection) =>
      connection.requests.filter(({ method }) => method === 'droid.get_context_breakdown')

    it('follows a chat Droid compacted in place, since no turn ends to move it', async () => {
      const { connection, run } = await startedSession()
      connection.replies.set('droid.compact_session', () => ({
        newSessionId: 'droid-session-1',
        removedCount: 5
      }))
      connection.replies.set('droid.get_context_breakdown', () => DROID_CONTEXT_BREAKDOWN)

      await run({ name: 'compress' })

      expect(methods(connection).slice(-2)).toEqual([
        'droid.compact_session',
        'droid.get_context_breakdown'
      ])
    })

    it('is left alone when Droid moved the summary to another session', async () => {
      const { connection, run } = await startedSession()
      connection.replies.set('droid.compact_session', () => ({ newSessionId: 'droid-session-2' }))

      await run({ name: 'compress' })

      expect(breakdownReads(connection)).toEqual([])
    })

    it('does not fail the compression when Droid cannot read its context after it', async () => {
      const { connection, run } = await startedSession()
      connection.replies.set('droid.compact_session', () => ({
        newSessionId: 'droid-session-1',
        removedCount: 2
      }))
      connection.replies.set('droid.get_context_breakdown', () => {
        throw new DroidRpcError(-32601, 'Method not found')
      })

      expect(await run({ name: 'compress' })).toEqual({
        name: 'compress',
        removedCount: 2,
        newSessionId: null
      })
    })
  })

  it('says Droid needs updating when it has no compact method, and writes no row', async () => {
    const { h, connection, run } = await startedSession()
    connection.replies.set('droid.compact_session', () => {
      throw new DroidRpcError(-32601, 'Method not found')
    })

    await expect(run({ name: 'compress' })).rejects.toThrow(
      'Compacting the conversation needs a newer Droid. Update Droid and try again.'
    )
    expect(await h.rig.rows()).toEqual([])
  })
})

describe('Droid /cost', () => {
  const creditsAfter = async (usage: Record<string, unknown>) => {
    const { connection, run } = await startedSession()
    connection.notify(usage)
    const result = await run({ name: 'credits' })
    expect(methods(connection).filter((method) => /cost/i.test(method))).toEqual([])
    return result
  }

  it('reports the credits on the session total, which counts subagents', async () => {
    expect(
      await creditsAfter(droidTokenUsageChanged({ tokenUsage: 400, inclusiveTokenUsage: 505 }))
    ).toEqual({ name: 'credits', factoryCredits: 505 })
  })

  it('falls back to the credits on tokenUsage when the inclusive total has none', async () => {
    expect(await creditsAfter(droidTokenUsageChanged({ tokenUsage: 400 }))).toEqual({
      name: 'credits',
      factoryCredits: 400
    })
  })

  it('counts zero credits as a figure', async () => {
    expect(
      await creditsAfter(droidTokenUsageChanged({ tokenUsage: 0, inclusiveTokenUsage: 0 }))
    ).toEqual({ name: 'credits', factoryCredits: 0 })
  })

  it('takes no credits from the last call, only from the session totals', async () => {
    expect(await creditsAfter(droidTokenUsageChanged({ lastCallTokenUsage: 9999 }))).toEqual({
      name: 'credits',
      factoryCredits: null
    })
  })

  it('reports none before Droid has reported any', async () => {
    const { run } = await startedSession()
    expect(await run({ name: 'credits' })).toEqual({ name: 'credits', factoryCredits: null })
  })
})

describe('Droid /rename', () => {
  const renamingSession = async () => {
    const onTitle = vi.fn()
    const h = await setupDroidAdapter({}, undefined, { onTitle })
    const { connection } = await h.start()
    const run = (title: string) =>
      h.adapter.droidCommand({
        sessionId: DROID_RIG_SESSION,
        fence: 7,
        command: { name: 'rename', title }
      })
    return { h, connection, onTitle, run }
  }

  it('asks Droid to rename the session, and sends no message', async () => {
    const { connection, run } = await renamingSession()

    expect(await run('Fix the login redirect')).toEqual({
      name: 'rename',
      title: 'Fix the login redirect'
    })

    expect(connection.requests.filter(({ method }) => method === 'droid.rename_session')).toEqual([
      { method: 'droid.rename_session', params: { title: 'Fix the login redirect' } }
    ])
    expect(methods(connection)).not.toContain('droid.add_user_message')
  })

  it('gives Droid, and answers with, the title on one line without the spaces around it', async () => {
    const { connection, run } = await renamingSession()

    expect(await run('  Two\nlines  ')).toEqual({ name: 'rename', title: 'Two lines' })

    expect(connection.requests.filter(({ method }) => method === 'droid.rename_session')).toEqual([
      { method: 'droid.rename_session', params: { title: 'Two lines' } }
    ])
  })

  it('asks Droid nothing for a title with nothing to show', async () => {
    const { connection, run } = await renamingSession()

    await expect(run(' \u200b\n ')).rejects.toThrow('Give the chat a title to rename it to.')

    expect(methods(connection)).not.toContain('droid.rename_session')
  })

  it('opens no turn', async () => {
    const { h, run } = await renamingSession()

    await run('Quiet')

    expect(await h.rig.turns()).toHaveLength(0)
    expect(h.idle).not.toHaveBeenCalled()
  })

  describe('as Droid 0.251.0 answered it', () => {
    it('names the chat from the rename Droid reports, which comes before its answer', async () => {
      const exchanges = await readDroidExchanges('rename-session')
      const { connection, onTitle, run } = await renamingSession()
      connection.replies.set('droid.rename_session', replayExchange(connection, exchanges, 'r1'))

      expect(await run('Capture rename')).toEqual({ name: 'rename', title: 'Capture rename' })

      expect(onTitle.mock.calls).toEqual([
        [{ sessionId: DROID_RIG_SESSION, title: 'Capture rename' }]
      ])
    })
  })

  it('says so when Droid answers that it did not rename', async () => {
    const { connection, run } = await renamingSession()
    connection.replies.set('droid.rename_session', () => ({ success: false }))

    await expect(run('Nope')).rejects.toThrow('Droid did not rename the conversation.')
  })

  it.each([
    ['a verdict that is not true', { success: 'false' }],
    ['a verdict of nothing', { success: null }]
  ])('does not take %s as the rename it asked for', async (_label, answer) => {
    const { connection, run } = await renamingSession()
    connection.replies.set('droid.rename_session', () => answer)

    await expect(run('Nope')).rejects.toThrow('Droid did not rename the conversation.')
  })

  it('takes an answer without a verdict as the rename it asked for', async () => {
    const { connection, run } = await renamingSession()
    connection.replies.set('droid.rename_session', () => ({}))

    expect(await run('Fine')).toEqual({ name: 'rename', title: 'Fine' })
  })

  it('says Droid needs updating when it has no rename method', async () => {
    const { connection, run } = await renamingSession()
    connection.replies.set('droid.rename_session', () => {
      throw new DroidRpcError(-32601, 'Method not found')
    })

    await expect(run('Old Droid')).rejects.toThrow(
      'Renaming the conversation needs a newer Droid. Update Droid and try again.'
    )
  })

  it('passes Droid’s own refusal on in its words', async () => {
    const { connection, run } = await renamingSession()
    connection.replies.set('droid.rename_session', () => {
      throw new DroidRpcError(-32602, 'Invalid title')
    })

    await expect(run('Bad')).rejects.toThrow('Invalid title')
  })
})
