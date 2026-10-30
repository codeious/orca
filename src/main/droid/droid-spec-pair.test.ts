import { afterEach, describe, expect, it } from 'vitest'
import { DROID_SPEC_SAME_AS_MAIN } from '../../shared/droid-spec-pair-options'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type DroidAdapterRig,
  type FakeConnection
} from './droid-adapter-rig.test-support'
import { DROID_AGENT, DROID_HANDLE_TRANSPORT } from './droid-agent-definition'

afterEach(runDroidRigCleanups)

const FENCE = 7

const priorSession = {
  linkId: 'prior',
  handle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: 'droid-session-9' },
  origin: 'created' as const,
  mintedAtFence: 1,
  observedAt: 100
}

/** A Droid that applies what it is sent, null clears included, and reports the whole it holds. */
async function startHeldDroid(
  held: Record<string, unknown>,
  options?: Readonly<Record<string, string>>
) {
  const h = await setupDroidAdapter({ autonomyLevel: 'low' }, (connection: FakeConnection) => {
    connection.replies.set('droid.initialize_session', () => ({
      sessionId: 's-1',
      settings: held,
      availableModels: [{ id: 'main' }, { id: 'spec-1' }, { id: 'spec-2' }]
    }))
    connection.replies.set('droid.update_session_settings', (params) => {
      Object.assign(held, params)
      connection.notify({ type: 'settings_updated', requestId: connection.lastId, settings: held })
      return {}
    })
  })
  const { connection } = await h.start(options)
  return { ...h, connection }
}

const pick = (h: { adapter: DroidAdapterRig['adapter'] }, key: string, value: string) =>
  h.adapter.setOption({ sessionId: DROID_RIG_SESSION, key, value, fence: FENCE })

const framesOf = (connection: FakeConnection) =>
  connection.requests.map(({ method, params }) => ({ method, params }))

describe('Droid Spec model and effort at start', () => {
  it('starts in Spec with the pair under the Spec keys and the main pair under the main keys', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'low' })

    const { connection } = await h.start({
      planMode: 'true',
      model: 'claude-haiku-5-5',
      effort: 'off',
      specModel: 'spec-1',
      specEffort: 'low'
    })

    const initialize = connection.requests.find(
      ({ method }) => method === 'droid.initialize_session'
    )
    expect(initialize?.params).toMatchObject({
      interactionMode: 'spec',
      autonomyLevel: 'low',
      modelId: 'claude-haiku-5-5',
      reasoningEffort: 'off',
      specModeModelId: 'spec-1',
      specModeReasoningEffort: 'low'
    })
    expect(initialize?.params).not.toHaveProperty('mission')
    expect(initialize?.params).not.toHaveProperty('missionSettings')
  })

  it('sends no Spec keys when no pair was set', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'low' })

    const { connection } = await h.start({ planMode: 'true', model: 'claude-haiku-5-5' })

    const initialize = connection.requests.find(
      ({ method }) => method === 'droid.initialize_session'
    )
    expect(initialize?.params).toMatchObject({
      interactionMode: 'spec',
      modelId: 'claude-haiku-5-5'
    })
    expect(initialize?.params).not.toHaveProperty('specModeModelId')
    expect(initialize?.params).not.toHaveProperty('specModeReasoningEffort')
  })

  it('applies the saved pair to a resumed chat together with the main pair', async () => {
    const resumed = await setupDroidAdapter({ previous: priorSession, autonomyLevel: 'off' })

    const { connection } = await resumed.start({
      planMode: 'true',
      model: 'main',
      effort: 'low',
      specModel: 'spec-2',
      specEffort: 'xhigh'
    })

    expect(framesOf(connection)).toEqual([
      { method: 'droid.load_session', params: { sessionId: 'droid-session-9' } },
      {
        method: 'droid.update_session_settings',
        params: { autonomyLevel: 'off', interactionMode: 'spec' }
      },
      {
        method: 'droid.update_session_settings',
        params: {
          modelId: 'main',
          reasoningEffort: 'low',
          specModeModelId: 'spec-2',
          specModeReasoningEffort: 'xhigh'
        }
      }
    ])
  })

  it('accepts the pair as a resting option of a Droid chat, and no other Spec key', () => {
    expect(DROID_AGENT.restingOptions.acceptsKey('specModel')).toBe(true)
    expect(DROID_AGENT.restingOptions.acceptsKey('specEffort')).toBe(true)
    expect(DROID_AGENT.restingOptions.acceptsKey('specMode')).toBe(false)
  })
})

describe('Droid Spec model and effort in a running chat', () => {
  const inSpec = () =>
    startHeldDroid({
      modelId: 'main',
      reasoningEffort: 'off',
      interactionMode: 'spec',
      autonomyMode: 'spec',
      autonomyLevel: 'off',
      specModeModelId: 'spec-1',
      specModeReasoningEffort: 'low'
    })

  it('reads the pair apart from the main model and effort, which stay what they were', async () => {
    const h = await inSpec()

    const { current } = await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })

    expect(current).toMatchObject({
      planMode: true,
      model: 'main',
      effort: 'off',
      specModel: 'spec-1',
      specEffort: 'low'
    })
  })

  it('sets the Spec model under its own key and returns the whole map', async () => {
    const h = await inSpec()

    await expect(pick(h, 'specModel', 'spec-2')).resolves.toEqual({
      planMode: 'true',
      model: 'main',
      effort: 'off',
      specModel: 'spec-2',
      specEffort: 'low'
    })
    expect(h.connection.requests.at(-1)?.params).toEqual({ specModeModelId: 'spec-2' })
  })

  it('sets the Spec effort under its own key', async () => {
    const h = await inSpec()

    await expect(pick(h, 'specEffort', 'xhigh')).resolves.toMatchObject({
      specModel: 'spec-1',
      specEffort: 'xhigh'
    })
    expect(h.connection.requests.at(-1)?.params).toEqual({ specModeReasoningEffort: 'xhigh' })
  })

  it('clears both with null on the wire when the Spec model is cleared, and keeps neither', async () => {
    const h = await inSpec()

    const stored = await pick(h, 'specModel', DROID_SPEC_SAME_AS_MAIN)

    expect(h.connection.requests.at(-1)?.params).toEqual({
      specModeModelId: null,
      specModeReasoningEffort: null
    })
    expect(stored).toEqual({ planMode: 'true', model: 'main', effort: 'off' })
    const { current } = await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })
    expect(current).not.toHaveProperty('specModel')
    expect(current).not.toHaveProperty('specEffort')
  })

  it('clears only the effort when the Spec effort is cleared', async () => {
    const h = await inSpec()

    const stored = await pick(h, 'specEffort', DROID_SPEC_SAME_AS_MAIN)

    expect(h.connection.requests.at(-1)?.params).toEqual({ specModeReasoningEffort: null })
    expect(stored).toEqual({
      planMode: 'true',
      model: 'main',
      effort: 'off',
      specModel: 'spec-1'
    })
  })

  it('shows the pair as cleared even when Droid acknowledges a clear without repeating the keys', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'low' }, (connection) => {
      connection.replies.set('droid.initialize_session', () => ({
        sessionId: 's-1',
        settings: {
          modelId: 'main',
          interactionMode: 'spec',
          specModeModelId: 'spec-1',
          specModeReasoningEffort: 'low'
        },
        availableModels: [{ id: 'main' }, { id: 'spec-1' }]
      }))
      connection.replies.set('droid.update_session_settings', () => {
        connection.notify({
          type: 'settings_updated',
          requestId: connection.lastId,
          settings: { modelId: 'main', interactionMode: 'spec' }
        })
        return {}
      })
    })
    await h.start()

    const stored = await pick(h, 'specModel', DROID_SPEC_SAME_AS_MAIN)

    expect(stored).not.toHaveProperty('specModel')
    expect(stored).not.toHaveProperty('specEffort')
  })

  it('sends a main model pick under the main key and leaves the pair alone', async () => {
    const h = await inSpec()

    await expect(pick(h, 'model', 'spec-2')).resolves.toEqual({
      planMode: 'true',
      model: 'spec-2',
      effort: 'off',
      specModel: 'spec-1',
      specEffort: 'low'
    })
    expect(h.connection.requests.at(-1)?.params).toEqual({ modelId: 'spec-2' })
  })

  it('rejects a Spec pick the child refuses, rather than showing a change it did not make', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'low' }, (connection) => {
      connection.replies.set('droid.initialize_session', () => ({
        sessionId: 's-1',
        settings: { modelId: 'main', interactionMode: 'spec' },
        availableModels: [{ id: 'main' }]
      }))
      connection.replies.set('droid.update_session_settings', () => {
        throw new Error('Invalid specModeModelId')
      })
    })
    await h.start()

    await expect(pick(h, 'specModel', 'nope')).rejects.toBeInstanceOf(Error)
    const { current } = await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })
    expect(current).not.toHaveProperty('specModel')
  })
})
