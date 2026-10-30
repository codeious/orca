import { afterEach, describe, expect, it } from 'vitest'
import type { AgentJournalMessageItem } from '../../shared/agent-session-journal-types'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type DroidAdapterRig
} from './droid-adapter-rig.test-support'
import { DroidRpcError } from './droid-rpc-errors'

afterEach(runDroidRigCleanups)

const FENCE = 7

// Droid answers a method it lacks with code -32601, "Unknown method: <name>" and no `data`
// (research/protocol-captures/session-extras.jsonl, droid.this_method_is_not_real).
const lacks = (method: string) => () => {
  throw new DroidRpcError(-32601, `Unknown method: ${method}`)
}

const text = (value: string): AgentJournalMessageItem => ({
  kind: 'message',
  role: 'user',
  blocks: [{ type: 'text', text: value }]
})

const sessionOf = (h: DroidAdapterRig) => h.adapter['session'](DROID_RIG_SESSION, FENCE)

const sendNext = (h: DroidAdapterRig, value: string) =>
  h.adapter.dispatch({
    sessionId: DROID_RIG_SESSION,
    clientMessageId: `next-${value}`,
    body: text(value),
    fence: FENCE
  })

const sentTexts = (connection: { requests: { method: string; params: unknown }[] }) =>
  connection.requests
    .filter(({ method }) => method === 'droid.add_user_message')
    .map(({ params }) =>
      typeof params === 'object' && params !== null && 'text' in params ? params.text : undefined
    )

const SESSION_METHODS = [
  'droid.compact_session',
  'droid.fork_session',
  'droid.get_rewind_info',
  'droid.execute_rewind',
  'droid.rename_session',
  'droid.get_context_stats',
  'droid.change_working_directory',
  'droid.list_skills',
  'droid.set_skill_disabled',
  'droid.add_mcp_server',
  'droid.remove_mcp_server',
  'droid.toggle_mcp_server',
  'droid.authenticate_mcp_server',
  'droid.submit_bug_report'
]

describe('a session method this Droid does not have', () => {
  it.each(SESSION_METHODS)(
    'says %s needs a newer Droid, and the next message still sends',
    async (method) => {
      const h = await setupDroidAdapter({}, (connection) =>
        connection.replies.set(method, lacks(method))
      )
      const { connection } = await h.start()

      const refused = sessionOf(h).request(method, {})

      await expect(refused).rejects.toThrow(/needs a newer Droid/)
      await expect(refused).rejects.not.toThrow(method)
      expect(connection.closed).toBe(false)
      await sendNext(h, 'still here')
      expect(sentTexts(connection)).toEqual(['still here'])
    }
  )

  it('keeps the code, so a caller that tells a missing method by it still can', async () => {
    const h = await setupDroidAdapter({}, (connection) =>
      connection.replies.set('droid.compact_session', lacks('droid.compact_session'))
    )
    await h.start()

    await expect(sessionOf(h).request('droid.compact_session', {})).rejects.toMatchObject({
      name: 'DroidRpcError',
      code: -32601
    })
  })

  it('leaves droid.close_session, which is not one of them, with Droid’s own words', async () => {
    const h = await setupDroidAdapter({}, (connection) =>
      connection.replies.set('droid.close_session', lacks('droid.close_session'))
    )
    await h.start()

    await expect(sessionOf(h).request('droid.close_session', {})).rejects.toThrow(
      'Unknown method: droid.close_session'
    )
  })

  it('passes any other refusal of such a method on in Droid’s own words', async () => {
    const h = await setupDroidAdapter({}, (connection) =>
      connection.replies.set('droid.rename_session', () => {
        throw new DroidRpcError(-32602, 'Invalid title')
      })
    )
    await h.start()

    await expect(sessionOf(h).request('droid.rename_session', {})).rejects.toThrow('Invalid title')
  })
})

describe('an autonomy pick on a Droid without droid.update_session_settings', () => {
  it('shows that it needs a newer Droid in a sentence a client may quote, and the chat keeps working', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'low' }, (connection) =>
      connection.replies.set(
        'droid.update_session_settings',
        lacks('droid.update_session_settings')
      )
    )
    const { connection } = await h.start()

    const refused = h.adapter.setOption({
      sessionId: DROID_RIG_SESSION,
      key: 'autonomyLevel',
      value: 'high',
      fence: FENCE
    })

    await expect(refused).rejects.toMatchObject({
      message: expect.stringMatching(/needs a newer Droid/),
      refusalReason: 'providerRefusedOption'
    })
    expect(connection.closed).toBe(false)
    await sendNext(h, 'after the refusal')
    expect(sentTexts(connection)).toEqual(['after the refusal'])
  })
})
