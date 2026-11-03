import { afterEach, describe, expect, it } from 'vitest'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter
} from './droid-adapter-rig.test-support'
import { droidSessionOptionDescriptors } from './droid-session-option-descriptors'

afterEach(runDroidRigCleanups)
describe('Droid session option descriptors', () => {
  it('describes the reported autonomy choices as Permissions', () => {
    const rows = droidSessionOptionDescriptors(
      { autonomyLevel: 'medium', availableAutonomyLevels: ['off', 'low', 'medium', 'high'] },
      { current: {}, models: [] }
    )
    expect(rows.find((row) => row.id === 'autonomyLevel')).toEqual({
      id: 'autonomyLevel',
      label: 'Permissions',
      scope: 'session',
      category: 'mode',
      transport: 'agent-session',
      valueSource: 'reported',
      settable: true,
      kind: {
        type: 'select',
        currentValue: 'medium',
        choices: [
          { value: 'off', label: 'Off', description: 'Asks before edits and commands' },
          {
            value: 'low',
            label: 'Low',
            description: 'Edits files and runs read-only commands; asks for the rest'
          },
          {
            value: 'medium',
            label: 'Medium',
            description:
              'Also runs reversible commands like installs, builds and local commits; asks for the rest'
          },
          {
            value: 'high',
            label: 'High',
            description: 'Runs commands without asking, except ones Droid blocks'
          }
        ]
      }
    })
  })
  it('reads current autonomy and the Spec pair from merged host reports', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    connection.replies.set('droid.list_models', () => ({
      models: [
        { id: 'main', supportedReasoningEfforts: ['low'] },
        { id: 'planner', supportedReasoningEfforts: ['high'] }
      ]
    }))
    connection.notify({
      type: 'settings_updated',
      settings: {
        modelId: 'main',
        availableAutonomyLevels: ['off', 'low'],
        autonomyLevel: 'low',
        specModeModelId: 'planner',
        specModeReasoningEffort: 'high'
      }
    })
    const read = () => h.adapter.readOptions({ sessionId: DROID_RIG_SESSION, fence: 7 })
    const first = await read()
    expect(first?.sessionOptions?.map((row) => [row.id, row.scope, row.kind.currentValue])).toEqual(
      [
        ['autonomyLevel', 'session', 'low'],
        ['specModel', 'session', 'planner'],
        ['specEffort', 'session', 'high']
      ]
    )
    connection.notify({
      type: 'settings_updated',
      settings: { autonomyLevel: 'off', availableAutonomyLevels: [] }
    })
    expect((await read())?.sessionOptions?.find((row) => row.id === 'autonomyLevel')).toMatchObject(
      {
        settable: false,
        valueSource: 'reported',
        kind: { type: 'select', currentValue: 'off', choices: [] }
      }
    )
    expect(
      (await read())?.sessionOptions?.find((row) => row.id === 'specModel')?.kind.currentValue
    ).toBe('planner')
    expect((await read())?.current.model).toBe('main')
  })
  it('uses the Spec model effort listing and never invents unoffered autonomy levels', () => {
    const rows = droidSessionOptionDescriptors(
      { autonomyLevel: 'low', availableAutonomyLevels: ['off'], specModeModelId: 'planner' },
      {
        current: { model: 'main' },
        models: [
          {
            id: 'main',
            label: 'Main',
            isDefault: false,
            efforts: [{ value: 'low', label: 'Low' }]
          },
          {
            id: 'planner',
            label: 'Planner',
            isDefault: false,
            efforts: [{ value: 'high', label: 'High' }]
          }
        ]
      }
    )
    expect(rows[0]?.kind).toMatchObject({ choices: [{ value: 'off', label: 'Off' }] })
    expect(rows[2]?.kind).toMatchObject({
      choices: [
        { value: 'same-as-main', label: 'Same as main' },
        { value: 'high', label: 'High' }
      ]
    })
  })
})
