// A model change Droid answers with an error: the refusal carries Droid's own sentence under a
// reason that lets a client quote it, the model Droid holds does not move, and the next change
// goes through. Spec, the level and a request Droid never answered stay on the generic refusal.

import { afterEach, describe, expect, it } from 'vitest'
import { isAgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type DroidAdapterRig,
  type FakeConnection
} from './droid-adapter-rig.test-support'
import { DroidRpcError } from './droid-rpc-errors'

afterEach(runDroidRigCleanups)

const FENCE = 7
const ORG_POLICY =
  "Model not allowed by organization policy: This model is not available due to your organization's security settings."

/** A Droid that holds `main`, lists three models and answers a change to `blocked` with -32603. */
function droidBlockingOneModel(connection: FakeConnection): void {
  const settings: Record<string, unknown> = {
    modelId: 'main',
    reasoningEffort: 'off',
    interactionMode: 'auto',
    autonomyLevel: 'off'
  }
  connection.replies.set('droid.initialize_session', () => ({
    sessionId: 's-1',
    settings: { ...settings },
    availableModels: [{ id: 'main' }, { id: 'blocked' }, { id: 'next' }]
  }))
  connection.replies.set('droid.update_session_settings', (params) => {
    const asked = typeof params === 'object' && params !== null ? { ...params } : {}
    if ('modelId' in asked && asked.modelId === 'blocked') {
      throw new DroidRpcError(-32603, ORG_POLICY)
    }
    Object.assign(settings, asked)
    connection.notify({
      type: 'settings_updated',
      requestId: connection.lastId,
      settings: { ...settings }
    })
    return {}
  })
}

const pick = (h: Pick<DroidAdapterRig, 'adapter'>, key: string, value: string) =>
  h.adapter.setOption({ sessionId: DROID_RIG_SESSION, key, value, fence: FENCE })

const optionsOf = async (h: Pick<DroidAdapterRig, 'adapter'>) =>
  (await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })).current

describe('a model change Droid refuses', () => {
  it('is refused in Droid’s own words, under the reason a client may quote, and the model stays', async () => {
    const h = await setupDroidAdapter({}, droidBlockingOneModel)
    const { connection } = await h.start({ model: 'main' })

    const refused = pick(h, 'model', 'blocked')

    await expect(refused).rejects.toSatisfy(isAgentSessionOptionRejectedError)
    await expect(refused).rejects.toMatchObject({
      message: ORG_POLICY,
      refusalReason: 'optionRejected',
      rejection: { kind: 'providerRejected' }
    })
    expect(connection.requests.at(-1)).toMatchObject({
      method: 'droid.update_session_settings',
      params: { modelId: 'blocked' }
    })
    expect(connection.closed).toBe(false)
    expect(await optionsOf(h)).toMatchObject({ model: 'main' })
  })

  it('lets the next model change through, and the models Droid lists stay listed', async () => {
    const h = await setupDroidAdapter({}, droidBlockingOneModel)
    await h.start({ model: 'main' })
    await pick(h, 'model', 'blocked').catch(() => {})

    await expect(pick(h, 'model', 'next')).resolves.toMatchObject({ model: 'next' })

    expect(await optionsOf(h)).toMatchObject({ model: 'next' })
    const listed = await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: FENCE })
    expect(listed.models.map((model) => model.id)).toEqual(['main', 'blocked', 'next'])
  })

  it('gives an effort change Droid refuses the same reason', async () => {
    const h = await setupDroidAdapter({}, (connection) => {
      droidBlockingOneModel(connection)
      connection.replies.set('droid.update_session_settings', () => {
        throw new DroidRpcError(-32602, 'Invalid reasoningEffort')
      })
    })
    await h.start({ model: 'main' })

    await expect(pick(h, 'effort', 'max')).rejects.toMatchObject({
      message: 'Invalid reasoningEffort',
      refusalReason: 'optionRejected',
      rejection: { kind: 'providerRejected' }
    })
  })
})

describe('a refusal that is not Droid giving a reason', () => {
  it('keeps the generic reason for a request that failed without an answer', async () => {
    const h = await setupDroidAdapter({}, (connection) => {
      droidBlockingOneModel(connection)
      connection.replies.set('droid.update_session_settings', () => {
        throw new Error('socket hung up')
      })
    })
    await h.start({ model: 'main' })

    await expect(pick(h, 'model', 'next')).rejects.toMatchObject({
      refusalReason: 'optionRejected'
    })
  })

  it('keeps the generic reason where Droid does not know the request at all', async () => {
    const h = await setupDroidAdapter({}, (connection) => {
      droidBlockingOneModel(connection)
      connection.replies.set('droid.update_session_settings', () => {
        throw new DroidRpcError(-32601, 'Method not found')
      })
    })
    await h.start({ model: 'main' })

    await expect(pick(h, 'model', 'next')).rejects.toMatchObject({
      refusalReason: 'optionRejected'
    })
  })

  it('keeps the generic reason for the autonomy level and for Spec', async () => {
    const h = await setupDroidAdapter({}, (connection) => {
      droidBlockingOneModel(connection)
      connection.replies.set('droid.update_session_settings', () => {
        throw new DroidRpcError(-32602, 'Invalid value')
      })
    })
    await h.start({ model: 'main' })

    await expect(pick(h, 'autonomyLevel', 'high')).rejects.toMatchObject({
      refusalReason: 'optionRejected'
    })
    await expect(pick(h, 'planMode', 'true')).rejects.toMatchObject({
      refusalReason: 'optionRejected'
    })
  })
})
