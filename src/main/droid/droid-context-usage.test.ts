import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalMessageItem } from '../../shared/agent-session-journal-types'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type DroidAdapterRig,
  type FakeConnection
} from './droid-adapter-rig.test-support'
import { DROID_CONTEXT_BREAKDOWN, droidTokenUsageChanged } from './droid-context-usage.test-support'

afterEach(runDroidRigCleanups)

const text = (value: string): AgentJournalMessageItem => ({
  kind: 'message',
  role: 'user',
  blocks: [{ type: 'text', text: value }]
})

async function finishATurn(
  h: DroidAdapterRig,
  connection: FakeConnection,
  usage: Record<string, unknown>
): Promise<void> {
  await h.adapter.dispatch({
    sessionId: DROID_RIG_SESSION,
    clientMessageId: 'send-1',
    body: text('Reply with the single word ok.'),
    fence: 7
  })
  connection.notify({
    type: 'droid_working_state_changed',
    newState: 'streaming_assistant_message'
  })
  connection.echo('Reply with the single word ok.')
  connection.notify(usage)
  connection.notify({
    type: 'create_message',
    message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'ok' }] }
  })
  connection.notify({ type: 'agent_turn_completed', reason: 'completed' })
}

const latestContext = async (h: DroidAdapterRig) => (await h.rig.turns()).at(-1)?.contextUsage

describe('Droid context usage', () => {
  it('gives the ring the breakdown Droid reports once a turn ends', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    connection.replies.set('droid.get_context_breakdown', () => DROID_CONTEXT_BREAKDOWN)

    await finishATurn(
      h,
      connection,
      droidTokenUsageChanged({ tokenUsage: 505, inclusiveTokenUsage: 505 })
    )

    await vi.waitFor(async () =>
      expect(await latestContext(h)).toEqual({
        used: {
          kind: 'report',
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
    )
  })
})
