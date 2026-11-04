import { afterEach, expect, it } from 'vitest'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type FakeConnection
} from './droid-adapter-rig.test-support'

afterEach(runDroidRigCleanups)

function reportedSession(
  connection: FakeConnection,
  spec: Record<string, string | undefined> = {}
) {
  const settings = {
    modelId: 'main',
    reasoningEffort: 'low',
    interactionMode: 'spec',
    ...spec
  }
  connection.replies.set('droid.initialize_session', () => ({
    sessionId: 'droid-session-1',
    settings: { ...settings },
    availableModels: [
      { id: 'main', supportedReasoningEfforts: ['low', 'medium'] },
      { id: 'planner', supportedReasoningEfforts: ['high', 'max'] },
      { id: 'next', supportedReasoningEfforts: ['off'] }
    ]
  }))
  connection.replies.set('droid.update_session_settings', (params) => {
    Object.assign(settings, params)
    connection.notify({
      type: 'settings_updated',
      requestId: connection.lastId,
      settings: { ...settings }
    })
    return {}
  })
}

it('shows the reported Spec model and effort instead of the saved main pair', async () => {
  const h = await setupDroidAdapter({}, (connection) =>
    reportedSession(connection, {
      specModeModelId: 'planner',
      specModeReasoningEffort: 'high'
    })
  )
  await h.start({ planMode: 'true', model: 'main', effort: 'low' })
  const answer = await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: 7 })
  expect(answer.current).toMatchObject({ planMode: true, model: 'planner', effort: 'high' })
})

it.each([
  { spec: {}, model: 'main', effort: 'low' },
  { spec: { specModeReasoningEffort: 'medium' }, model: 'main', effort: 'medium' },
  { spec: { specModeModelId: 'planner' }, model: 'planner', effort: undefined }
])('shows $model with effort $effort for Spec settings $spec', async ({ spec, model, effort }) => {
  const h = await setupDroidAdapter({}, (connection) => reportedSession(connection, spec))
  await h.start({ planMode: 'true', model: 'main', effort: 'low' })
  const answer = await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: 7 })
  expect(answer.current.model).toBe(model)
  expect(answer.current.effort).toBe(effort)
  if (!effort) {
    expect(answer.current.confirmed).not.toContain('effort')
  }
})

it('returns to the main pair when Spec is turned off without saving the Spec pair as main', async () => {
  const h = await setupDroidAdapter({}, (connection) =>
    reportedSession(connection, {
      specModeModelId: 'planner',
      specModeReasoningEffort: 'high'
    })
  )
  await h.start({ planMode: 'true', model: 'main', effort: 'low' })
  await expect(
    h.adapter.setOption({ sessionId: DROID_RIG_SESSION, fence: 7, key: 'planMode', value: 'false' })
  ).resolves.toMatchObject({ planMode: 'false', model: 'main', effort: 'low' })
  expect(
    (await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: 7 })).current
  ).toMatchObject({ planMode: false, model: 'main', effort: 'low' })
})

it.each([
  {
    key: 'model',
    value: 'next',
    params: { specModeModelId: 'next' },
    saved: { specModel: 'next' }
  },
  {
    key: 'effort',
    value: 'max',
    params: { specModeReasoningEffort: 'max' },
    saved: { specEffort: 'max' }
  }
])(
  'changes only the Spec pair for a $key pick while Spec is on',
  async ({ key, value, params, saved }) => {
    const h = await setupDroidAdapter({}, (connection) =>
      reportedSession(connection, {
        specModeModelId: 'planner',
        specModeReasoningEffort: 'high'
      })
    )
    const { connection } = await h.start({ planMode: 'true', model: 'main', effort: 'low' })
    const result = await h.adapter.setOption({ sessionId: DROID_RIG_SESSION, fence: 7, key, value })
    expect(connection.requests.at(-1)).toMatchObject({
      method: 'droid.update_session_settings',
      params
    })
    expect(result).toMatchObject({ planMode: 'true', model: 'main', effort: 'low', ...saved })
    expect(
      (await h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: 7 })).current[key]
    ).toBe(value)
  }
)
