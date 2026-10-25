import { afterEach, describe, expect, it } from 'vitest'
import { isAgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type FakeConnection
} from './droid-adapter-rig.test-support'
import { DROID_AGENT } from './droid-agent-definition'
import { readDroidExchanges, replayExchange } from './droid-recording.test-support'
import { DroidRpcError } from './droid-rpc-errors'

afterEach(runDroidRigCleanups)

const FENCE = 7
const MAIN = '<custom-model-1>'
const SPEC = '<custom-model-2>'

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
