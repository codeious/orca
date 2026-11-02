import { afterEach, describe, expect, it } from 'vitest'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter
} from './droid-adapter-rig.test-support'
import { DroidRpcError } from './droid-rpc-errors'
import { forkDroidSession, rewindDroidSession } from './droid-fork-and-rewind'
import { structuredAgentSessionCommandTurn } from '../../shared/agent-session/view/structured-agent-session-command-turn-identity'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../shared/agent-session/journal/agent-session-journal-types'
import type { StructuredAgentSessionCommandRun } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { DroidAdapterRig } from './droid-adapter-rig.test-support'

afterEach(runDroidRigCleanups)

async function commandIn(
  h: DroidAdapterRig,
  clientMessageId: string
): Promise<StructuredAgentSessionCommandRun> {
  const turn = structuredAgentSessionCommandTurn(clientMessageId)
  const command: StructuredAgentSessionCommandRun = {
    ...turn,
    clientMessageId,
    running: { kind: 'turn', turnId: turn.turnId, state: 'running', requestedAt: Date.now() }
  }
  h.rig.eventSink.appendItem(command.identity, command.running, {
    turnScope: AGENT_JOURNAL_THREAD_SCOPE
  })
  await h.rig.rows()
  return command
}

describe('Droid session commands', () => {
  it('journals host text without sending a model message', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    expect(
      await h.adapter.hostCommand({
        sessionId: DROID_RIG_SESSION,
        fence: 7,
        name: 'context',
        argument: '',
        operationId: 'read-context'
      })
    ).toEqual({ text: 'Droid has not reported context usage.' })
    expect(connection.requests.some(({ method }) => method === 'droid.add_user_message')).toBe(
      false
    )
    expect(
      (await h.rig.rows()).some(
        ({ body }) =>
          body.kind === 'status' && body.text === 'Droid has not reported context usage.'
      )
    ).toBe(true)
  })

  it('completes compaction through the shared command turn', async () => {
    const h = await setupDroidAdapter(
      {},
      (connection) => {
        connection.replies.set('droid.compact_session', () => ({ removedCount: 4 }))
      },
      { readCompactionSummary: async () => null }
    )
    await h.start()
    const command = await commandIn(h, 'compact-1')
    expect(await h.adapter.compact({ sessionId: DROID_RIG_SESSION, fence: 7, command })).toEqual({
      state: 'accepted',
      providerIdentity: null
    })
    expect(
      (await h.rig.rows()).some(
        ({ body }) => body.kind === 'status' && body.text === 'Compacted 4 messages.'
      )
    ).toBe(true)
  })

  it('preserves provider rejection without leaving an open command', async () => {
    const h = await setupDroidAdapter(
      {},
      (connection) => {
        connection.replies.set('droid.compact_session', () => {
          throw new DroidRpcError(-32000, 'Compaction is unavailable')
        })
      },
      { readCompactionSummary: async () => null }
    )
    await h.start()
    expect(
      await h.adapter.compact({
        sessionId: DROID_RIG_SESSION,
        fence: 7,
        command: await commandIn(h, 'compact-refused')
      })
    ).toMatchObject({ state: 'rejected' })
  })

  it('forks and rewinds only to confirmed new sessions, keeping disk files', async () => {
    const requests: { method: string; params: unknown }[] = []
    const session = {
      droidSessionId: 'original',
      request: async (method: string, params: unknown) => {
        requests.push({ method, params })
        return { newSessionId: 'copy' }
      }
    }
    expect(await forkDroidSession(session)).toEqual({ newSessionId: 'copy' })
    expect(await rewindDroidSession(session, 'prompt-1')).toEqual({ newSessionId: 'copy' })
    expect(requests.at(-1)).toEqual({
      method: 'droid.execute_rewind',
      params: {
        sessionId: 'original',
        messageId: 'prompt-1',
        filesToRestore: [],
        filesToDelete: [],
        forkTitle: 'Rewound conversation'
      }
    })
    session.request = async () => ({ newSessionId: 'original' })
    await expect(forkDroidSession(session)).rejects.toThrow('confirm a new fork')
  })
})
