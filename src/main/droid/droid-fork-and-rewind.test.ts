import { afterEach, describe, expect, it } from 'vitest'
import type { DroidHostCommand } from '../../shared/droid-host-command'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type FakeConnection
} from './droid-adapter-rig.test-support'
import { readDroidExchanges, replayExchange } from './droid-recording.test-support'
import { DroidRpcError } from './droid-rpc-errors'

afterEach(runDroidRigCleanups)

// The session the recording was made on: the id every recorded rewind names.
const RECORDED_SESSION = '00000000-0000-4000-8000-000000000001'
const RECORDED_MESSAGE = '00000000-0000-4000-8000-000000000003'

async function startedSession(droidSessionId = RECORDED_SESSION) {
  const h = await setupDroidAdapter({}, (child) =>
    child.replies.set('droid.initialize_session', () => ({ sessionId: droidSessionId }))
  )
  const { connection } = await h.start()
  const run = (command: DroidHostCommand) =>
    h.adapter.droidCommand({ sessionId: DROID_RIG_SESSION, fence: 7, command })
  return { h, connection, run }
}

const calls = (connection: FakeConnection, method: string) =>
  connection.requests.filter((request) => request.method === method).map(({ params }) => params)

describe('Droid /fork', () => {
  it('asks Droid to fork with a title, and hands back the different session it made', async () => {
    const exchanges = await readDroidExchanges('fork-and-rewind')
    const { connection, run } = await startedSession()
    connection.replies.set('droid.fork_session', replayExchange(connection, exchanges, 'r1'))

    expect(await run({ name: 'fork' })).toEqual({
      name: 'fork',
      newSessionId: '00000000-0000-4000-8000-000000000005'
    })
    expect(calls(connection, 'droid.fork_session')).toEqual([{ title: 'Forked conversation' }])
  })

  it('sends no message and loads no session: the chat stays where it is', async () => {
    const { connection, run } = await startedSession()
    connection.replies.set('droid.fork_session', () => ({ newSessionId: 'droid-fork-1' }))

    await run({ name: 'fork' })

    const methods = connection.requests.map(({ method }) => method)
    expect(methods).not.toContain('droid.add_user_message')
    expect(methods).not.toContain('droid.load_session')
  })

  it('fails when Droid answers with the chat’s own session, which is no fork', async () => {
    const { connection, run } = await startedSession()
    connection.replies.set('droid.fork_session', () => ({ newSessionId: RECORDED_SESSION }))

    await expect(run({ name: 'fork' })).rejects.toThrow(
      'Droid did not return a new session for the fork. Try again.'
    )
  })

  it('fails when Droid names no session at all', async () => {
    const { connection, run } = await startedSession()
    connection.replies.set('droid.fork_session', () => ({}))

    await expect(run({ name: 'fork' })).rejects.toThrow(
      'Droid did not return a new session for the fork. Try again.'
    )
  })

  it('says Droid needs updating when it has no fork method', async () => {
    const { connection, run } = await startedSession()
    connection.replies.set('droid.fork_session', () => {
      throw new DroidRpcError(-32601, 'Unknown method: droid.fork_session')
    })

    await expect(run({ name: 'fork' })).rejects.toThrow(
      'Forking the conversation needs a newer Droid. Update Droid and try again.'
    )
  })
})

describe('Droid rewind', () => {
  const rewind = (run: Awaited<ReturnType<typeof startedSession>>['run']) =>
    run({ name: 'rewind', messageId: RECORDED_MESSAGE })

  it('reads what the rewind touches, then executes it on the same message, as recorded', async () => {
    const exchanges = await readDroidExchanges('fork-and-rewind')
    const { connection, run } = await startedSession()
    connection.replies.set('droid.get_rewind_info', replayExchange(connection, exchanges, 'r2'))
    connection.replies.set('droid.execute_rewind', replayExchange(connection, exchanges, 'r3'))

    expect(await rewind(run)).toEqual({
      name: 'rewind',
      newSessionId: '00000000-0000-4000-8000-000000000006',
      restoredCount: 0,
      deletedCount: 0,
      notRestoredCount: 0
    })
    expect(calls(connection, 'droid.get_rewind_info')).toEqual([
      { sessionId: RECORDED_SESSION, messageId: RECORDED_MESSAGE }
    ])
    expect(calls(connection, 'droid.execute_rewind')).toEqual([
      {
        sessionId: RECORDED_SESSION,
        messageId: RECORDED_MESSAGE,
        filesToRestore: [],
        filesToDelete: [],
        forkTitle: 'Rewound conversation'
      }
    ])
    expect(connection.requests.map(({ method }) => method)).not.toContain('droid.add_user_message')
  })

  it('deletes the files the turn created, as recorded', async () => {
    const exchanges = await readDroidExchanges('fork-and-rewind')
    const { connection, run } = await startedSession()
    connection.replies.set('droid.get_rewind_info', replayExchange(connection, exchanges, 'r4'))
    connection.replies.set('droid.execute_rewind', replayExchange(connection, exchanges, 'r5'))

    expect(await rewind(run)).toEqual({
      name: 'rewind',
      newSessionId: '00000000-0000-4000-8000-000000000007',
      restoredCount: 0,
      deletedCount: 1,
      notRestoredCount: 0
    })
    expect(calls(connection, 'droid.execute_rewind')).toEqual([
      {
        sessionId: RECORDED_SESSION,
        messageId: RECORDED_MESSAGE,
        filesToRestore: [],
        filesToDelete: [{ filePath: '/work/probe/rewind-probe.txt' }],
        forkTitle: 'Rewound conversation'
      }
    ])
  })

  it('restores the files Droid still holds, with the hash and size it named', async () => {
    const { connection, run } = await startedSession()
    const held = { filePath: '/work/probe/notes.md', contentHash: 'abc123', size: 42 }
    connection.replies.set('droid.get_rewind_info', () => ({
      availableFiles: [held],
      createdFiles: [],
      evictedFiles: []
    }))
    connection.replies.set('droid.execute_rewind', () => ({
      newSessionId: 'droid-rewound-1',
      restoredCount: 1,
      deletedCount: 0,
      failedRestoreCount: 0,
      failedDeleteCount: 0
    }))

    const result = await rewind(run)

    expect(calls(connection, 'droid.execute_rewind')).toEqual([
      expect.objectContaining({ filesToRestore: [held], filesToDelete: [] })
    ])
    expect(result).toMatchObject({ restoredCount: 1, deletedCount: 0 })
  })

  it('counts the files it could not put back: evicted ones and failed ones', async () => {
    const { connection, run } = await startedSession()
    connection.replies.set('droid.get_rewind_info', () => ({
      availableFiles: [],
      createdFiles: [],
      evictedFiles: [{ filePath: '/work/probe/big.bin', reason: 'too_large' }]
    }))
    connection.replies.set('droid.execute_rewind', () => ({
      newSessionId: 'droid-rewound-1',
      restoredCount: 0,
      deletedCount: 0,
      failedRestoreCount: 2,
      failedDeleteCount: 1
    }))

    expect(await rewind(run)).toMatchObject({ notRestoredCount: 4 })
  })

  it('fails, and says the files were handled, when a completed rewind names no different session', async () => {
    const { connection, run } = await startedSession()
    connection.replies.set('droid.get_rewind_info', () => ({
      availableFiles: [],
      createdFiles: [],
      evictedFiles: []
    }))
    connection.replies.set('droid.execute_rewind', () => ({
      newSessionId: RECORDED_SESSION,
      restoredCount: 0,
      deletedCount: 0,
      failedRestoreCount: 0,
      failedDeleteCount: 0
    }))

    await expect(rewind(run)).rejects.toThrow(
      'Droid rewound the conversation but did not return a new session. Open Session History to find it.'
    )
  })

  it('executes nothing when Droid cannot say what the rewind touches', async () => {
    const { connection, run } = await startedSession()
    connection.replies.set('droid.get_rewind_info', () => {
      throw new DroidRpcError(-32601, 'Unknown method: droid.get_rewind_info')
    })

    await expect(rewind(run)).rejects.toThrow(
      'Rewinding the conversation needs a newer Droid. Update Droid and try again.'
    )
    expect(calls(connection, 'droid.execute_rewind')).toEqual([])
  })
})
