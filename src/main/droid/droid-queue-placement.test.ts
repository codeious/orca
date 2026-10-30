import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AgentJournalMessageItem } from '../../shared/agent-session-journal-types'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter
} from './droid-adapter-rig.test-support'

afterEach(runDroidRigCleanups)

const FENCE = 7

// Recordings of a live Droid 0.251.0: `in` is Orca to Droid, `out` is Droid to Orca.
const recordedFrame = z.looseObject({
  type: z.string().optional(),
  method: z.string().optional(),
  params: z
    .looseObject({
      text: z.string().optional(),
      queuePlacement: z.string().optional(),
      notification: z.record(z.string(), z.unknown()).optional()
    })
    .optional()
})

// The closing `exit` row has no frame.
const recordedRow = z.object({ dir: z.string(), frame: recordedFrame.optional() })

function recording(file: string) {
  return readFileSync(join(import.meta.dirname, '__fixtures__', file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => recordedRow.parse(JSON.parse(line)))
}

const text = (value: string): AgentJournalMessageItem => ({
  kind: 'message',
  role: 'user',
  blocks: [{ type: 'text', text: value }]
})

/** Plays a recording against the adapter. `waitForSecond`: the person pressed Ctrl+Enter, not Enter,
 *  for the message the recording sends while its first turn runs. */
async function replay(file: string, waitForSecond: boolean) {
  const h = await setupDroidAdapter()
  const { connection } = await h.start()
  const recordedSends: unknown[] = []
  let sends = 0
  for (const { dir, frame } of recording(file)) {
    if (dir === 'in' && frame?.method === 'droid.add_user_message') {
      sends += 1
      recordedSends.push(frame.params)
      await h.adapter.dispatch({
        sessionId: DROID_RIG_SESSION,
        clientMessageId: `send-${sends}`,
        body: text(frame.params?.text ?? ''),
        fence: FENCE,
        ...(sends === 2 && waitForSecond ? { afterReply: true as const } : {})
      })
    } else if (dir === 'out' && frame?.type === 'notification' && frame.params?.notification) {
      connection.notify(frame.params.notification)
    }
  }
  const sent = connection.requests
    .filter(({ method }) => method === 'droid.add_user_message')
    .map(({ params }) => params)
  return { h, sent, recordedSends }
}

describe('a message sent while a Droid turn runs', () => {
  it('steers with end_of_turn when the person pressed Enter, and the turn ends once', async () => {
    const { h, sent, recordedSends } = await replay('queue-end-of-turn.jsonl', false)

    expect(sent).toEqual(recordedSends)
    expect(sent[1]).toMatchObject({ queuePlacement: 'end_of_turn' })
    expect(JSON.stringify(sent)).not.toContain('end_of_loop')
    expect(h.settled.mock.calls.map(([settlement]) => settlement.outcome.state)).toEqual([
      'accepted',
      'accepted'
    ])
    const turns = await h.rig.turns()
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ state: 'completed', outcome: 'success' })
  })

  it('waits with end_of_loop when the person pressed Ctrl+Enter, and the turn still ends once', async () => {
    const { h, sent, recordedSends } = await replay('queue-end-of-loop.jsonl', true)

    expect(sent).toEqual(recordedSends)
    expect(sent[1]).toMatchObject({ queuePlacement: 'end_of_loop' })
    expect(JSON.stringify(sent)).not.toContain('end_of_turn')
    expect(h.settled.mock.calls.map(([settlement]) => settlement.outcome.state)).toEqual([
      'accepted',
      'accepted'
    ])
    const turns = await h.rig.turns()
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ state: 'completed', outcome: 'success' })
  })

  it('waits when the earlier message has not been echoed yet, so a turn is starting', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    await h.adapter.dispatch({
      sessionId: DROID_RIG_SESSION,
      clientMessageId: 'prompt-1',
      body: text('hello'),
      fence: FENCE
    })
    await h.adapter.dispatch({
      sessionId: DROID_RIG_SESSION,
      clientMessageId: 'wait-1',
      body: text('later'),
      fence: FENCE,
      afterReply: true
    })

    expect(connection.requests.slice(1).map(({ params }) => params)).toEqual([
      { text: 'hello' },
      { text: 'later', queuePlacement: 'end_of_loop' }
    ])
  })
})

describe('a message sent while no Droid turn runs', () => {
  it('goes out with no placement for Enter and for Ctrl+Enter alike', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    await h.adapter.dispatch({
      sessionId: DROID_RIG_SESSION,
      clientMessageId: 'idle-enter',
      body: text('idle-enter'),
      fence: FENCE
    })
    connection.echo('idle-enter')
    connection.notify({ type: 'agent_turn_completed', reason: 'completed', turnId: 't' })
    await h.adapter.dispatch({
      sessionId: DROID_RIG_SESSION,
      clientMessageId: 'idle-ctrl-enter',
      body: text('idle-ctrl-enter'),
      fence: FENCE,
      afterReply: true
    })

    expect(connection.requests.slice(1).map(({ params }) => params)).toEqual([
      { text: 'idle-enter' },
      { text: 'idle-ctrl-enter' }
    ])
    expect(JSON.stringify(connection.requests)).not.toContain('end_of_loop')
  })
})
