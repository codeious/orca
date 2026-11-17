import { afterEach, expect, it } from 'vitest'
import { structuredAgentSessionCommandTurn } from '../../shared/agent-session/view/structured-agent-session-command-turn-identity'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../shared/agent-session/journal/agent-session-journal-types'
import type {
  StructuredAgentSessionAdapter,
  StructuredAgentSessionCommandRun
} from '../native-chat/agent-session-wire/providers/structured-agent-session-adapter'
import { runDroidRigCleanups, setupDroidAdapter } from './droid-adapter-rig.test-support'
import { DroidRpcError } from './droid-rpc-errors'

afterEach(runDroidRigCleanups)

it('completes compaction through the shared command turn', async () => {
  const h = await setupDroidAdapter(
    {},
    (connection) => {
      connection.replies.set('droid.compact_session', () => ({ removedCount: 4 }))
    },
    { readCompactionSummary: async () => null }
  )
  await h.start()
  const turn = structuredAgentSessionCommandTurn('compact-1')
  const command: StructuredAgentSessionCommandRun = {
    ...turn,
    clientMessageId: 'compact-1',
    running: { kind: 'turn', turnId: turn.turnId, state: 'running', requestedAt: 1 }
  }
  h.rig.eventSink.appendItem(command.identity, command.running, {
    turnScope: AGENT_JOURNAL_THREAD_SCOPE
  })
  await h.rig.rows()
  const adapter: StructuredAgentSessionAdapter = h.adapter
  expect(
    await adapter.compact?.({ sessionId: h.input.identity.sessionId, fence: 7, command })
  ).toEqual({ state: 'accepted', providerIdentity: null })
  expect(await h.rig.turns()).toMatchObject([{ state: 'completed' }])
})

it('returns Droid compaction refusal rather than accepting the command', async () => {
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
  const turn = structuredAgentSessionCommandTurn('compact-refused')
  const adapter: StructuredAgentSessionAdapter = h.adapter
  expect(
    await adapter.compact?.({
      sessionId: h.input.identity.sessionId,
      fence: 7,
      command: {
        ...turn,
        clientMessageId: 'compact-refused',
        running: { kind: 'turn', turnId: turn.turnId, state: 'running', requestedAt: 1 }
      }
    })
  ).toMatchObject({ state: 'rejected' })
})

it('forks only to a new provider session', async () => {
  const h = await setupDroidAdapter({}, (connection) => {
    connection.replies.set('droid.fork_session', () => ({ newSessionId: 'copied-session' }))
  })
  const { connection } = await h.start()
  const adapter: StructuredAgentSessionAdapter = h.adapter
  const input = {
    identity: h.input.identity,
    providerSessionId: 'droid-session-1',
    accountHome: { variable: 'ORCA_DROID_ACCOUNT_HOME', path: '/host/.factory' }
  }
  expect(await adapter.copyConversation?.(input)).toEqual({ sessionId: 'copied-session' })
  connection.replies.set('droid.fork_session', () => ({ newSessionId: 'droid-session-1' }))
  await expect(adapter.copyConversation?.(input)).rejects.toThrow('confirm a new fork')
})
