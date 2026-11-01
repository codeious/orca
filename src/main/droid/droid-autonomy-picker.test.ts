// The autonomy level of a Droid chat: the one picked before the first message rides the start, a
// change after it goes out as a settings update, and the level shown is the one Droid reports.

import { afterEach, describe, expect, it } from 'vitest'
import { STRUCTURED_LAUNCH_SEED_OPTION_IDS } from '../../shared/native-chat-session-option-defaults'
import { AgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type DroidAdapterRig,
  type FakeConnection
} from './droid-adapter-rig.test-support'
import { DROID_AGENT, DROID_HANDLE_TRANSPORT } from './droid-agent-definition'
import { DroidRpcError } from './droid-rpc-errors'

afterEach(runDroidRigCleanups)

const FENCE = 7
const ALL = ['off', 'low', 'medium', 'high']

const priorSession = {
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

const FOLLOWED = ['autonomyLevel', 'interactionMode', 'modelId', 'reasoningEffort'] as const

/** A Droid that offers `available`, runs the highest of them when asked for more, and reports it. */
function droidOffering(available: string[], held: Record<string, unknown> = {}) {
  return (connection: FakeConnection) => {
    const settings: Record<string, unknown> = {
      modelId: 'main',
      reasoningEffort: 'off',
      interactionMode: 'auto',
      autonomyLevel: 'off',
      availableAutonomyLevels: available,
      ...held
    }
    const apply = (params: unknown) => {
      const asked = typeof params === 'object' && params !== null ? Object.entries(params) : []
      for (const [key, value] of asked) {
        if (FOLLOWED.some((followed) => followed === key)) {
          settings[key] = value
        }
      }
      const level = settings.autonomyLevel
      if (typeof level === 'string' && !available.includes(level)) {
        settings.autonomyLevel = available.at(-1)
      }
    }
    connection.replies.set('droid.initialize_session', (params) => {
      apply(params)
      return { sessionId: 's-1', settings: { ...settings }, availableModels: [{ id: 'main' }] }
    })
    connection.replies.set('droid.update_session_settings', (params) => {
      apply(params)
      connection.notify({
        type: 'settings_updated',
        requestId: connection.lastId,
        settings: { ...settings }
      })
      return {}
    })
  }
}

const initializeOf = (connection: FakeConnection) =>
  connection.requests.find(({ method }) => method === 'droid.initialize_session')?.params

const pick = (h: Pick<DroidAdapterRig, 'adapter'>, key: string, value: string) =>
  h.adapter.setOption({ sessionId: DROID_RIG_SESSION, key, value, fence: FENCE })

const optionsOf = async (h: Pick<DroidAdapterRig, 'adapter'>) =>
  (await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })).current

async function statusRows(h: DroidAdapterRig) {
  return (await h.rig.rows()).flatMap(({ body }) => (body.kind === 'status' ? [body] : []))
}

describe('the autonomy level picked before the first message', () => {
  it('rides droid.initialize_session in place of the Agent Permissions level', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'high' }, droidOffering(ALL))

    const { connection } = await h.start({ model: 'main', autonomyLevel: 'low' })

    expect(initializeOf(connection)).toMatchObject({
      interactionMode: 'auto',
      autonomyLevel: 'low'
    })
  })

  it('rides the same start as Spec and the Spec pair, and Spec leaves the level as picked', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'high' }, droidOffering(ALL))

    const { connection } = await h.start({
      planMode: 'true',
      autonomyLevel: 'low',
      model: 'main',
      specModel: 'spec-1',
      specEffort: 'low'
    })

    const initialize = initializeOf(connection)
    expect(initialize).toMatchObject({
      interactionMode: 'spec',
      autonomyLevel: 'low',
      specModeModelId: 'spec-1',
      specModeReasoningEffort: 'low'
    })
    expect(initialize).not.toHaveProperty('mission')
    expect(initialize).not.toHaveProperty('missionSettings')
  })

  it.each([
    ['no level was picked', undefined],
    ['the saved level is one Droid does not define', { autonomyLevel: 'ultra' }]
  ])('sends the Agent Permissions level when %s', async (_name, saved) => {
    const h = await setupDroidAdapter({ autonomyLevel: 'medium' }, droidOffering(ALL))

    const { connection } = await h.start(saved)

    expect(initializeOf(connection)).toMatchObject({ autonomyLevel: 'medium' })
  })

  it('sends the picked level again when a saved chat is resumed', async () => {
    const h = await setupDroidAdapter(
      { previous: priorSession, autonomyLevel: 'high' },
      droidOffering(ALL)
    )

    const { connection } = await h.start({ autonomyLevel: 'low' })

    expect(connection.requests.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: 'droid.load_session', params: { sessionId: 'droid-session-9' } },
      {
        method: 'droid.update_session_settings',
        params: { autonomyLevel: 'low', interactionMode: 'auto' }
      }
    ])
  })

  it('sends Off again on resume when Off was saved and Agent Permissions run higher', async () => {
    const h = await setupDroidAdapter(
      { previous: priorSession, autonomyLevel: 'high' },
      droidOffering(ALL)
    )

    const { connection } = await h.start({ autonomyLevel: 'off', planMode: 'false' })

    expect(connection.requests.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: 'droid.load_session', params: { sessionId: 'droid-session-9' } },
      {
        method: 'droid.update_session_settings',
        params: { autonomyLevel: 'off', interactionMode: 'auto' }
      }
    ])
  })

  it('does not blame Agent Permissions when Droid runs below a level the person picked', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'high' }, droidOffering(['off', 'low']))

    await h.start({ autonomyLevel: 'high' })

    expect(await statusRows(h)).toEqual([])
  })
})

describe('the autonomy level of a running Droid chat', () => {
  it('reads the level Droid holds and the levels it offers', async () => {
    const h = await setupDroidAdapter({}, droidOffering(['off', 'low'], { autonomyLevel: 'low' }))
    await h.start()

    expect(await optionsOf(h)).toMatchObject({
      autonomyLevel: 'low',
      availableAutonomyLevels: ['off', 'low']
    })
  })

  it('reads the lowest offered level when Droid runs below the one a chat started with', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'high' }, droidOffering(['off', 'low']))
    await h.start({ autonomyLevel: 'high' })

    expect(await optionsOf(h)).toMatchObject({
      autonomyLevel: 'low',
      availableAutonomyLevels: ['off', 'low']
    })
  })

  it('changes the level with droid.update_session_settings and returns the whole map', async () => {
    const h = await setupDroidAdapter({}, droidOffering(ALL))
    const { connection } = await h.start({ model: 'main', planMode: 'false' })

    const stored = await pick(h, 'autonomyLevel', 'medium')

    expect(connection.requests.at(-1)).toMatchObject({
      method: 'droid.update_session_settings',
      params: { autonomyLevel: 'medium' }
    })
    expect(stored).toMatchObject({ autonomyLevel: 'medium', model: 'main', planMode: 'false' })
    expect(await optionsOf(h)).toMatchObject({ autonomyLevel: 'medium' })
  })

  it('shows the level Droid reports when it runs a lower one than was asked for', async () => {
    const h = await setupDroidAdapter({}, droidOffering(['off', 'low', 'medium']))
    const { connection } = await h.start()

    const stored = await pick(h, 'autonomyLevel', 'high')

    expect(connection.requests.at(-1)?.params).toEqual({ autonomyLevel: 'high' })
    expect(stored).toMatchObject({ autonomyLevel: 'medium' })
    expect(await optionsOf(h)).toMatchObject({ autonomyLevel: 'medium' })
  })

  it('keeps a level the person chose through a later model pick', async () => {
    const h = await setupDroidAdapter({}, droidOffering(ALL))
    await h.start({ model: 'main' })
    await pick(h, 'autonomyLevel', 'low')

    await expect(pick(h, 'model', 'main')).resolves.toMatchObject({ autonomyLevel: 'low' })
  })

  it('stores no level when the person never chose one, so Agent Permissions keeps deciding', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'high' }, droidOffering(ALL))
    await h.start({ model: 'main' })

    await expect(pick(h, 'model', 'main')).resolves.not.toHaveProperty('autonomyLevel')
  })

  it('rejects a level Droid does not define without asking Droid', async () => {
    const h = await setupDroidAdapter({}, droidOffering(ALL))
    const { connection } = await h.start()
    const before = connection.requests.length

    await expect(pick(h, 'autonomyLevel', 'ultra')).rejects.toBeInstanceOf(
      AgentSessionOptionRejectedError
    )
    expect(connection.requests).toHaveLength(before)
  })

  it('says a Droid without droid.update_session_settings needs a newer Droid, and stays up', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'low' }, (connection) => {
      droidOffering(ALL)(connection)
      connection.replies.set('droid.update_session_settings', () => {
        throw new DroidRpcError(-32601, 'Method not found')
      })
    })
    const { connection } = await h.start()

    const refused = pick(h, 'autonomyLevel', 'high')

    await expect(refused).rejects.toBeInstanceOf(AgentSessionOptionRejectedError)
    await expect(refused).rejects.toThrow(/needs a newer Droid/)
    expect(connection.closed).toBe(false)
    expect(await optionsOf(h)).toMatchObject({ autonomyLevel: 'low' })
  })

  it('passes another refusal on in Droid’s own words', async () => {
    const h = await setupDroidAdapter({}, (connection) => {
      droidOffering(ALL)(connection)
      connection.replies.set('droid.update_session_settings', () => {
        throw new DroidRpcError(-32602, 'Invalid autonomyLevel')
      })
    })
    await h.start()

    await expect(pick(h, 'autonomyLevel', 'high')).rejects.toThrow('Invalid autonomyLevel')
  })
})

describe('the autonomy level is not a catalog option', () => {
  it('is a resting option of a Droid chat, and its legacy name is not', () => {
    expect(DROID_AGENT.restingOptions.acceptsKey('autonomyLevel')).toBe(true)
    expect(DROID_AGENT.restingOptions.acceptsKey('autonomyMode')).toBe(false)
    expect(DROID_AGENT.restingOptions.acceptsKey('autonomy')).toBe(false)
  })

  it('is never a launch seed option, so no model remembers it', () => {
    expect(STRUCTURED_LAUNCH_SEED_OPTION_IDS).not.toContain('autonomyLevel')
    expect([...STRUCTURED_LAUNCH_SEED_OPTION_IDS]).toEqual([
      'model',
      'effort',
      'fastMode',
      'serviceTier',
      'planMode'
    ])
  })
})
