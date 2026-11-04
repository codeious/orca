import { afterEach, expect, it } from 'vitest'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type FakeConnection
} from './droid-adapter-rig.test-support'
import { DROID_HANDLE_TRANSPORT } from './droid-agent-definition'

afterEach(runDroidRigCleanups)

const previous = {
  linkId: 'prior',
  handle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: 'droid-session-9' },
  origin: 'created' as const,
  mintedAtFence: 1,
  observedAt: 100
}

function reportDefaults(connection: FakeConnection) {
  const settings = {
    modelId: 'sol',
    reasoningEffort: 'high',
    interactionMode: 'spec',
    specModeModelId: 'opus',
    specModeReasoningEffort: 'xhigh'
  }
  connection.replies.set('droid.initialize_session', () => ({
    sessionId: 'droid-session-1',
    settings,
    availableModels: [{ id: 'sol' }, { id: 'opus' }]
  }))
  connection.replies.set('droid.load_session', () => ({
    cwd: '/host/folder',
    settings,
    availableModels: [{ id: 'sol' }, { id: 'opus' }]
  }))
}

it('starts with both saved pairs under Droid settings keys', async () => {
  const h = await setupDroidAdapter()
  const { connection } = await h.start({
    model: 'sol',
    effort: 'high',
    specModel: 'opus',
    specEffort: 'xhigh'
  })
  expect(connection.requests[0]).toMatchObject({
    method: 'droid.initialize_session',
    params: {
      modelId: 'sol',
      reasoningEffort: 'high',
      specModeModelId: 'opus',
      specModeReasoningEffort: 'xhigh'
    }
  })
})

it.each([false, true])(
  'clears Same as main after %s resume without sending it as a model id',
  async (resume) => {
    const h = await setupDroidAdapter(resume ? { previous } : {}, reportDefaults)
    const { connection } = await h.start({
      model: 'sol',
      effort: 'high',
      planMode: 'true',
      specModel: 'same-as-main',
      specEffort: 'same-as-main'
    })
    expect(JSON.stringify(connection.requests)).not.toContain('same-as-main')
    expect(connection.requests[0]).toMatchObject({
      method: resume ? 'droid.load_session' : 'droid.initialize_session'
    })
    expect(connection.requests[0]?.params).not.toHaveProperty('specModeModelId')
    expect(connection.requests[0]?.params).not.toHaveProperty('specModeReasoningEffort')
    expect(connection.requests).toContainEqual(
      expect.objectContaining({
        method: 'droid.update_session_settings',
        params: expect.objectContaining({ specModeModelId: null, specModeReasoningEffort: null })
      })
    )
    const options = await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: 7 })
    expect(options.current).toMatchObject({ planMode: true, model: 'sol', effort: 'high' })
  }
)

it.each([false, true])('clears only the saved Spec effort after %s resume', async (resume) => {
  const h = await setupDroidAdapter(resume ? { previous } : {}, reportDefaults)
  const { connection } = await h.start({
    model: 'sol',
    planMode: 'true',
    specModel: 'opus',
    specEffort: 'same-as-main'
  })
  expect(JSON.stringify(connection.requests)).not.toContain('same-as-main')
  expect(connection.requests).toContainEqual(
    expect.objectContaining({
      method: 'droid.update_session_settings',
      params: expect.objectContaining({ specModeReasoningEffort: null })
    })
  )
  const options = await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: 7 })
  expect(options.current.model).toBe('opus')
  expect(options.current.effort).toBeUndefined()
})
