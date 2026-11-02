import { afterEach, describe, expect, it } from 'vitest'
import {
  runDroidRigCleanups,
  setupDroidAdapter,
  type DroidAdapterRig
} from './droid-adapter-rig.test-support'
import { DROID_HANDLE_TRANSPORT } from './droid-agent-definition'
import { readDroidExchanges, replayExchange } from './droid-recording.test-support'

afterEach(runDroidRigCleanups)

const CAPPED =
  'Droid is running at autonomy level Medium, below the High set in Agent Permissions. Your organization may limit it.'

const heldSession = {
  linkId: 'prior',
  handle: {
    transport: DROID_HANDLE_TRANSPORT,
    agent: 'droid' as const,
    nativeId: 'droid-session-9'
  },
  origin: 'created' as const,
  mintedAtFence: 1,
  observedAt: 100
}

async function statusRows(h: DroidAdapterRig) {
  return (await h.rig.rows()).flatMap(({ body }) => (body.kind === 'status' ? [body] : []))
}

describe('Droid org-capped autonomy level', () => {
  it('says once, in the chat, that a new session started below the level asked for', async () => {
    const cap = await readDroidExchanges('autonomy-cap-clamp')
    const h = await setupDroidAdapter({ autonomyLevel: 'high' }, (connection) =>
      connection.replies.set('droid.initialize_session', replayExchange(connection, cap, 'r1'))
    )
    await h.start()

    expect(h.connections[0]?.requests[0]?.params).toMatchObject({ autonomyLevel: 'high' })
    expect(await statusRows(h)).toEqual([{ kind: 'status', tone: 'warning', text: CAPPED }])
  })

  it('says it after a resume whose settings update came back lower', async () => {
    const cap = await readDroidExchanges('autonomy-cap-clamp')
    const h = await setupDroidAdapter(
      { autonomyLevel: 'high', previous: heldSession },
      (connection) =>
        connection.replies.set(
          'droid.update_session_settings',
          replayExchange(connection, cap, 'r2')
        )
    )
    await h.start()

    expect(await statusRows(h)).toEqual([{ kind: 'status', tone: 'warning', text: CAPPED }])
  })

  it('stays quiet when Droid runs the level that was asked for', async () => {
    const swapped = await readDroidExchanges('model-blocked-by-org')
    const h = await setupDroidAdapter({ autonomyLevel: 'off' }, (connection) =>
      connection.replies.set('droid.initialize_session', replayExchange(connection, swapped, 'r1'))
    )
    await h.start()

    expect(await statusRows(h)).toEqual([])
  })

  it('writes no transcript row when an organization swaps the model', async () => {
    const swapped = await readDroidExchanges('model-blocked-by-org')
    const h = await setupDroidAdapter({ autonomyLevel: 'off' }, (connection) =>
      connection.replies.set('droid.initialize_session', replayExchange(connection, swapped, 'r1'))
    )
    await h.start()

    expect(await h.rig.rows()).toEqual([])
  })
})
