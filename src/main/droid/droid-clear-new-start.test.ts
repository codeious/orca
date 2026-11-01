import { afterEach, describe, expect, it } from 'vitest'
import {
  DROID_NEW_SESSION_SETTINGS,
  droidFreshSessionOptionPicks,
  droidSettingsKeptByClear,
  type DroidFreshSessionSettings
} from '../../shared/droid-fresh-session-settings'
import type { SessionOptionDescriptor } from '../../shared/native-chat-session-options'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type FakeConnection
} from './droid-adapter-rig.test-support'

afterEach(runDroidRigCleanups)

/** A tab that is in Spec on the pinned model, at an autonomy level other than the one it opened on. */
const TAB_SNAPSHOT: SessionOptionDescriptor[] = [
  {
    id: 'model',
    label: 'Model',
    kind: { type: 'select', currentValue: 'claude-haiku-5-5', choices: [] },
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true
  },
  {
    id: 'effort',
    label: 'Effort',
    kind: { type: 'select', currentValue: 'off', choices: [] },
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true
  },
  {
    id: 'planMode',
    label: 'Spec',
    kind: { type: 'boolean', currentValue: true },
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true
  }
]

const TAB_SURFACE = {
  autonomy: {
    level: 'low' as const,
    levels: ['off', 'low', 'medium', 'high'] as const,
    settable: true
  },
  specPair: {
    model: 'spec-1',
    effort: 'low',
    modelChoices: [],
    effortChoices: [],
    settable: true
  }
}

function createOptions(settings: DroidFreshSessionSettings): Record<string, string> {
  return Object.fromEntries(droidFreshSessionOptionPicks(settings))
}

async function initializeParams(options?: Record<string, string>) {
  const h = await setupDroidAdapter({ autonomyLevel: 'high' })
  const { connection } = await (options ? h.start(options) : h.start())
  return { h, connection, params: initializeOf(connection) }
}

function initializeOf(connection: FakeConnection): object | undefined {
  const params = connection.requests.find(
    ({ method }) => method === 'droid.initialize_session'
  )?.params
  return typeof params === 'object' && params !== null ? params : undefined
}

describe('the Droid session /clear starts', () => {
  it('opens with the model, effort, autonomy level, Spec mode and Spec model pair of the tab it leaves', async () => {
    const kept = droidSettingsKeptByClear(TAB_SNAPSHOT, TAB_SURFACE)

    const { params } = await initializeParams(createOptions(kept))

    expect(params).toMatchObject({
      modelId: 'claude-haiku-5-5',
      reasoningEffort: 'off',
      interactionMode: 'spec',
      autonomyLevel: 'low',
      specModeModelId: 'spec-1',
      specModeReasoningEffort: 'low'
    })
    expect(params).not.toHaveProperty('mission')
    expect(params).not.toHaveProperty('missionSettings')
  })

  it('opens in Auto when the tab it leaves was in Auto, whatever the saved default says', async () => {
    const kept = droidSettingsKeptByClear(
      TAB_SNAPSHOT.map((row) =>
        row.id === 'planMode'
          ? { ...row, kind: { type: 'boolean' as const, currentValue: false } }
          : row
      ),
      TAB_SURFACE
    )

    const { params } = await initializeParams(createOptions(kept))

    expect(params).toMatchObject({ interactionMode: 'auto', autonomyLevel: 'low' })
  })

  it('never sends a stand-in id for a Spec pair that runs on the main model', async () => {
    const kept = droidSettingsKeptByClear(TAB_SNAPSHOT, {
      ...TAB_SURFACE,
      specPair: { ...TAB_SURFACE.specPair, model: null, effort: null }
    })

    const { params } = await initializeParams(createOptions(kept))

    expect(params).toMatchObject({ modelId: 'claude-haiku-5-5', interactionMode: 'spec' })
    expect(params).not.toHaveProperty('specModeModelId')
    expect(params).not.toHaveProperty('specModeReasoningEffort')
    expect(JSON.stringify(params)).not.toContain('same-as-main')
  })
})

describe('the Droid session /new starts', () => {
  it('opens in Auto with the settings a newly opened chat gets, whatever the tab it leaves ran on', async () => {
    const newChat = await initializeParams()
    await runDroidRigCleanups()

    const { params } = await initializeParams(createOptions(DROID_NEW_SESSION_SETTINGS))

    expect(params).toEqual(newChat.params)
    expect(params).toMatchObject({ interactionMode: 'auto', autonomyLevel: 'high' })
    expect(params).not.toHaveProperty('modelId')
    expect(params).not.toHaveProperty('reasoningEffort')
    expect(params).not.toHaveProperty('specModeModelId')
  })
})

describe('leaving the session behind', () => {
  it('sends droid.close_session neither to start the fresh session nor to end the old one', async () => {
    const { h, connection } = await initializeParams(
      createOptions(droidSettingsKeptByClear(TAB_SNAPSHOT, TAB_SURFACE))
    )

    await h.adapter.closeSession(DROID_RIG_SESSION)

    expect(connection.closed).toBe(true)
    expect(connection.requests.map(({ method }) => method)).not.toContain('droid.close_session')
  })
})
