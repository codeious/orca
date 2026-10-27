import { afterEach, describe, expect, it } from 'vitest'
import { isAgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import { nativeSessionOptionsFromReport } from '../native-chat/agent-session-wire/structured-agent-session-option-restoration'
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

/** A Droid that applies what it is sent and reports the whole of what it holds against the request. */
async function startHeldDroid(interactionMode: 'auto' | 'spec') {
  const held: Record<string, unknown> = {
    modelId: 'main',
    reasoningEffort: 'low',
    interactionMode,
    specModeModelId: 'spec-1',
    specModeReasoningEffort: 'high'
  }
  const h = await setupDroidAdapter({ autonomyLevel: 'off' }, (connection: FakeConnection) => {
    connection.replies.set('droid.initialize_session', () => ({
      sessionId: 's-1',
      settings: held,
      availableModels: [{ id: 'main' }, { id: 'spec-1' }, { id: 'spec-2' }]
    }))
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
  return h
}

async function setOption(
  h: { adapter: DroidAdapterRig['adapter'] },
  key: string,
  value: string
): Promise<Readonly<Record<string, string>>> {
  const picks = await h.adapter.setOption({
    sessionId: DROID_RIG_SESSION,
    key,
    value,
    fence: FENCE
  })
  if (!picks) {
    throw new Error('Droid answered the pick with no options')
  }
  return picks
}

/** Each pick stored the way the host does: what it returns replaces the chat's whole options map. */
async function storePicks(
  h: { adapter: DroidAdapterRig['adapter'] },
  picks: readonly (readonly [string, string])[]
): Promise<Record<string, string>> {
  let stored: Record<string, string> = {}
  for (const [key, value] of picks) {
    stored = { ...(await setOption(h, key, value)) }
  }
  return stored
}

async function framesOfResume(options: Readonly<Record<string, string>>) {
  const resumed = await setupDroidAdapter({ previous: heldSession, autonomyLevel: 'off' })
  const { connection } = await resumed.start(options)
  return connection.requests.map(({ method, params }) => ({ method, params }))
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

    // The recording's reply to every update holds the main model and `low` as Spec's, so that is what Droid reports back.
    const whole = { planMode: 'true', model: MAIN, effort: 'low' }
    await expect(pick(h).model(MAIN)).resolves.toEqual(whole)
    await expect(pick(h).effort('low')).resolves.toEqual(whole)

    expect(h.connection.requests.slice(-2).map(({ params }) => params)).toEqual([
      { specModeModelId: MAIN },
      { specModeReasoningEffort: 'low' }
    ])
    await expect(
      h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })
    ).resolves.toMatchObject({ current: { planMode: true, model: MAIN, effort: 'low' } })
  })

  it("stores Spec, its model and its effort in the chat's options, so the next start resumes in Spec on them", async () => {
    const h = await startHeldDroid('auto')

    const stored = await storePicks(h, [
      ['planMode', 'true'],
      ['model', 'spec-2'],
      ['effort', 'xhigh']
    ])

    expect(stored).toEqual({ planMode: 'true', model: 'spec-2', effort: 'xhigh' })
    await expect(framesOfResume(stored)).resolves.toEqual([
      { method: 'droid.load_session', params: { sessionId: 'droid-session-9' } },
      {
        method: 'droid.update_session_settings',
        params: { autonomyLevel: 'off', interactionMode: 'spec' }
      },
      {
        method: 'droid.update_session_settings',
        params: { specModeModelId: 'spec-2', specModeReasoningEffort: 'xhigh' }
      }
    ])
  })

  it('resumes in auto on the main pair after Spec is turned off', async () => {
    const h = await startHeldDroid('auto')

    const stored = await storePicks(h, [
      ['planMode', 'true'],
      ['model', 'spec-2'],
      ['effort', 'xhigh'],
      ['planMode', 'false']
    ])

    expect(stored).toEqual({ planMode: 'false', model: 'main', effort: 'low' })
    await expect(framesOfResume(stored)).resolves.toEqual([
      { method: 'droid.load_session', params: { sessionId: 'droid-session-9' } },
      {
        method: 'droid.update_session_settings',
        params: { autonomyLevel: 'off', interactionMode: 'auto' }
      },
      {
        method: 'droid.update_session_settings',
        params: { modelId: 'main', reasoningEffort: 'low' }
      }
    ])
  })

  describe('against what a later read rewrites the chat to', () => {
    const rewrittenBy = async (
      h: DroidAdapterRig,
      priorOptions: Readonly<Record<string, string>>
    ) => {
      const { current } = await h.adapter.readOptions({
        sessionId: DROID_RIG_SESSION,
        fence: FENCE
      })
      return nativeSessionOptionsFromReport({ reported: current, restoreSkipped: [], priorOptions })
    }

    it('keeps the map a pick returned when a read follows it', async () => {
      const h = await startHeldDroid('auto')

      const stored = await storePicks(h, [
        ['planMode', 'true'],
        ['model', 'spec-2'],
        ['effort', 'xhigh']
      ])

      await expect(rewrittenBy(h, stored)).resolves.toEqual(stored)
    })

    it('returns the map a read already rewrote the chat to when a pick follows it', async () => {
      const h = await startHeldDroid('spec')
      const rewritten = await rewrittenBy(h, {})
      expect(rewritten).toEqual({ planMode: 'true', model: 'spec-1', effort: 'high' })

      const picked = await setOption(h, 'model', 'spec-2')

      expect(picked).toEqual({ ...rewritten, model: 'spec-2' })
      await expect(rewrittenBy(h, picked)).resolves.toEqual(picked)
    })
  })

  it('shows the main model and effort again when Spec is turned off after a Spec pick', async () => {
    const h = await startHeldDroid('spec')

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

describe('Droid model and effort picks while Spec is off', () => {
  it('returns the whole map for a pick made in auto', async () => {
    const h = await startHeldDroid('auto')

    await expect(setOption(h, 'effort', 'xhigh')).resolves.toEqual({
      planMode: 'false',
      model: 'main',
      effort: 'xhigh'
    })
    await expect(setOption(h, 'model', 'spec-2')).resolves.toEqual({
      planMode: 'false',
      model: 'spec-2',
      effort: 'xhigh'
    })
  })
})

describe('Droid saved picks on a resume', () => {
  it('applies the saved model and effort to the Spec model when the chat resumes in Spec', async () => {
    await expect(
      framesOfResume({ planMode: 'true', model: 'spec-2', effort: 'low' })
    ).resolves.toEqual([
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
    await expect(framesOfResume({ model: 'main-2', effort: 'low' })).resolves.toEqual([
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

  describe('from a planted launch default', () => {
    const modeOfStart = async (options: Readonly<Record<string, string>>) => {
      const started = await setupDroidAdapter({ autonomyLevel: 'off' })
      const { connection } = await started.start(options)
      return connection.requests.find(({ method }) => method === 'droid.initialize_session')?.params
    }

    it('starts and resumes in Spec from the planted default', async () => {
      const options = { planMode: 'true', model: 'claude-haiku-5-5' }

      await expect(modeOfStart(options)).resolves.toMatchObject({ interactionMode: 'spec' })
      expect((await framesOfResume(options))[1]).toEqual({
        method: 'droid.update_session_settings',
        params: { autonomyLevel: 'off', interactionMode: 'spec' }
      })
    })

    it.each(['false', 'yes'])(
      'starts and resumes in auto when the planted default is %s',
      async (planMode) => {
        const options = { planMode, model: 'claude-haiku-5-5' }

        await expect(modeOfStart(options)).resolves.toMatchObject({ interactionMode: 'auto' })
        expect((await framesOfResume(options))[1]).toEqual({
          method: 'droid.update_session_settings',
          params: { autonomyLevel: 'off', interactionMode: 'auto' }
        })
      }
    )
  })
})
