import { afterEach, describe, expect, it } from 'vitest'
import { isAgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type DroidAdapterRig,
  type FakeConnection
} from './droid-adapter-rig.test-support'
import { DROID_AGENT, DROID_HANDLE_TRANSPORT } from './droid-agent-definition'
import { readDroidExchanges, replayExchange } from './droid-recording.test-support'
import { DroidRpcError } from './droid-rpc-errors'

afterEach(runDroidRigCleanups)

const FENCE = 7
const MAIN = '<custom-model-1>'
const SPEC = '<custom-model-2>'

const heldSession = {
  linkId: 'prior',
  handle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: 'droid-session-9' },
  origin: 'created' as const,
  mintedAtFence: 1,
  observedAt: 100
}

async function startInSpecFromRecording() {
  const recorded = await readDroidExchanges('spec-plan-approval-off')
  const h = await setupDroidAdapter({ autonomyLevel: 'off' }, (connection: FakeConnection) => {
    connection.replies.set('droid.initialize_session', replayExchange(connection, recorded, 'r1'))
    connection.replies.set(
      'droid.update_session_settings',
      replayExchange(connection, recorded, 'r2')
    )
  })
  const started = await h.start()
  return { ...h, ...started }
}

async function startFromRecording(updates: string[] = []) {
  const acks = await readDroidExchanges('update-settings-acks')
  let sent = 0
  const h = await setupDroidAdapter({ autonomyLevel: 'off' }, (connection: FakeConnection) => {
    connection.replies.set('droid.initialize_session', replayExchange(connection, acks, 'r1'))
    connection.replies.set('droid.update_session_settings', (params) => {
      const recorded = updates[sent++]
      if (!recorded) {
        throw new Error('The recording has no further update')
      }
      return replayExchange(connection, acks, recorded)(params)
    })
  })
  const started = await h.start()
  return { ...h, ...started }
}

describe('Droid Spec option', () => {
  it('reports Spec off and the main model when Droid starts in auto', async () => {
    const h = await startFromRecording()

    const options = await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })

    expect(options.current).toEqual({
      planMode: false,
      model: MAIN,
      effort: 'xhigh',
      confirmed: ['planMode', 'model', 'effort']
    })
  })

  it('turns Spec on by changing the interaction mode alone, and reads back the Spec model', async () => {
    const h = await startFromRecording(['r8'])

    const options = await h.adapter.setOption({
      sessionId: DROID_RIG_SESSION,
      key: 'planMode',
      value: 'true',
      fence: FENCE
    })

    expect(h.connection.requests.at(-1)).toMatchObject({
      method: 'droid.update_session_settings',
      params: { interactionMode: 'spec' }
    })
    expect(options).toEqual({ planMode: 'true', model: SPEC, effort: 'xhigh' })
    await expect(
      h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })
    ).resolves.toMatchObject({ current: { planMode: true, model: SPEC } })
  })

  it('returns to the main model when Spec is turned off again', async () => {
    const h = await startFromRecording(['r8', 'r9'])
    const pick = (value: string) =>
      h.adapter.setOption({ sessionId: DROID_RIG_SESSION, key: 'planMode', value, fence: FENCE })

    await pick('true')

    await expect(pick('false')).resolves.toEqual({
      planMode: 'false',
      model: MAIN,
      effort: 'xhigh'
    })
  })

  it('rejects the pick when Droid never reports the mode, rather than showing a flip it did not make', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'off' }, (connection) =>
      connection.replies.set('droid.initialize_session', () => ({
        sessionId: 's-1',
        settings: { interactionMode: 'auto', modelId: 'm' }
      }))
    )
    await h.start()

    await expect(
      h.adapter.setOption({
        sessionId: DROID_RIG_SESSION,
        key: 'planMode',
        value: 'true',
        fence: FENCE
      })
    ).rejects.toSatisfy(isAgentSessionOptionRejectedError)
    await expect(
      h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })
    ).resolves.toMatchObject({ current: { planMode: false } })
  })

  it('rejects the pick when Droid answers the settings update with an error', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'off' }, (connection) =>
      connection.replies.set('droid.update_session_settings', () => {
        throw new DroidRpcError(-32602, 'Invalid interactionMode')
      })
    )
    await h.start()

    await expect(
      h.adapter.setOption({
        sessionId: DROID_RIG_SESSION,
        key: 'planMode',
        value: 'true',
        fence: FENCE
      })
    ).rejects.toSatisfy(isAgentSessionOptionRejectedError)
    await expect(
      h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })
    ).resolves.toMatchObject({ current: { planMode: false } })
  })

  it('reads the main model in Spec when Droid reports no model of its own for it', async () => {
    const h = await setupDroidAdapter({ autonomyLevel: 'off' }, (connection) =>
      connection.replies.set('droid.initialize_session', () => ({
        sessionId: 's-1',
        settings: { interactionMode: 'spec', modelId: 'main', reasoningEffort: 'low' }
      }))
    )
    await h.start()

    const options = await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })

    expect(options.current).toMatchObject({ planMode: true, model: 'main', effort: 'low' })
  })

  it('keeps a Spec pick made while the chat is at rest, and no other key', () => {
    expect(DROID_AGENT.restingOptions.acceptsKey('planMode')).toBe(true)
    expect(DROID_AGENT.restingOptions.acceptsKey('fastMode')).toBe(false)
  })
})

describe('Droid model and effort picks while Spec is on', () => {
  const pick = (h: { adapter: DroidAdapterRig['adapter'] }) => ({
    model: (value: string) =>
      h.adapter.setOption({ sessionId: DROID_RIG_SESSION, key: 'model', value, fence: FENCE }),
    effort: (value: string) =>
      h.adapter.setOption({ sessionId: DROID_RIG_SESSION, key: 'effort', value, fence: FENCE })
  })

  it('sends a model and an effort pick under the Spec keys Droid itself writes, not the main ones', async () => {
    const h = await startInSpecFromRecording()

    await expect(pick(h).model(MAIN)).resolves.toEqual({ model: MAIN })
    await expect(pick(h).effort('low')).resolves.toEqual({ effort: 'low' })

    expect(h.connection.requests.slice(-2).map(({ params }) => params)).toEqual([
      { specModeModelId: MAIN },
      { specModeReasoningEffort: 'low' }
    ])
    await expect(
      h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })
    ).resolves.toMatchObject({ current: { planMode: true, model: MAIN, effort: 'low' } })
  })

  it('shows the main model and effort again when Spec is turned off after a Spec pick', async () => {
    const held: Record<string, unknown> = {
      modelId: 'main',
      reasoningEffort: 'low',
      interactionMode: 'spec',
      specModeModelId: 'spec-1',
      specModeReasoningEffort: 'high'
    }
    const h = await setupDroidAdapter({ autonomyLevel: 'off' }, (connection: FakeConnection) => {
      connection.replies.set('droid.initialize_session', () => ({
        sessionId: 's-1',
        settings: held,
        availableModels: [{ id: 'main' }, { id: 'spec-1' }, { id: 'spec-2' }]
      }))
      // Droid applies what it is sent and reports the whole of what it holds against the request.
      connection.replies.set('droid.update_session_settings', (params) => {
        Object.assign(held, params)
        connection.notify({
          type: 'settings_updated',
          requestId: connection.lastId,
          settings: held
        })
        return {}
      })
    })
    await h.start()

    await pick(h).model('spec-2')
    await pick(h).effort('xhigh')

    await expect(
      h.adapter.setOption({
        sessionId: DROID_RIG_SESSION,
        key: 'planMode',
        value: 'false',
        fence: FENCE
      })
    ).resolves.toEqual({ planMode: 'false', model: 'main', effort: 'low' })
  })
})

describe('Droid saved picks on a resume', () => {
  const resumed = async (options: Record<string, string>) => {
    const h = await setupDroidAdapter({ previous: heldSession, autonomyLevel: 'off' })
    const { connection } = await h.start(options)
    return connection.requests.map(({ method, params }) => ({ method, params }))
  }

  it('applies the saved model and effort to the Spec model when the chat resumes in Spec', async () => {
    await expect(resumed({ planMode: 'true', model: 'spec-2', effort: 'low' })).resolves.toEqual([
      { method: 'droid.load_session', params: { sessionId: 'droid-session-9' } },
      {
        method: 'droid.update_session_settings',
        params: { autonomyLevel: 'off', interactionMode: 'spec' }
      },
      {
        method: 'droid.update_session_settings',
        params: { specModeModelId: 'spec-2', specModeReasoningEffort: 'low' }
      }
    ])
  })

  it('applies the saved model and effort to the main model when the chat resumes in auto', async () => {
    await expect(resumed({ model: 'main-2', effort: 'low' })).resolves.toEqual([
      { method: 'droid.load_session', params: { sessionId: 'droid-session-9' } },
      {
        method: 'droid.update_session_settings',
        params: { autonomyLevel: 'off', interactionMode: 'auto' }
      },
      {
        method: 'droid.update_session_settings',
        params: { modelId: 'main-2', reasoningEffort: 'low' }
      }
    ])
  })
})
