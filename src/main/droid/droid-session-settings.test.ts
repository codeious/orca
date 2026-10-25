import { describe, expect, it } from 'vitest'
import {
  DroidReportedSettings,
  droidInteractionModeFromSavedOptions,
  parseDroidSettings
} from './droid-session-settings'

describe('Droid saved Spec mode', () => {
  it.each([
    [undefined, 'auto'],
    [{}, 'auto'],
    [{ planMode: 'false' }, 'auto'],
    [{ planMode: 'spec' }, 'auto'],
    [{ planMode: 'true' }, 'spec']
  ] as const)('reads %j as %s', (saved, mode) => {
    expect(droidInteractionModeFromSavedOptions(saved)).toBe(mode)
  })
})

describe('Droid reported settings', () => {
  it('reads the fields Orca uses and ignores the legacy autonomyMode', () => {
    expect(
      parseDroidSettings({
        modelId: 'custom-model-1',
        reasoningEffort: 'xhigh',
        autonomyMode: 'auto-medium',
        interactionMode: 'auto',
        autonomyLevel: 'medium',
        availableAutonomyLevels: ['off', 'low', 'medium'],
        specModeModelId: 'custom-model-2',
        specModeReasoningEffort: 'low',
        compactionThresholdCheckEnabled: true
      })
    ).toEqual({
      modelId: 'custom-model-1',
      reasoningEffort: 'xhigh',
      interactionMode: 'auto',
      autonomyLevel: 'medium',
      availableAutonomyLevels: ['off', 'low', 'medium'],
      specModeModelId: 'custom-model-2',
      specModeReasoningEffort: 'low'
    })
  })

  it('drops a level or mode Droid has not defined, and keeps the rest', () => {
    expect(
      parseDroidSettings({
        autonomyLevel: 'ultra',
        interactionMode: 'mission',
        availableAutonomyLevels: ['off', 'ultra', 'high'],
        modelId: ''
      })
    ).toEqual({ availableAutonomyLevels: ['off', 'high'] })
  })

  it.each([null, undefined, 'medium', 7, []])('reads %j as nothing reported', (value) => {
    expect(parseDroidSettings(value)).toEqual({})
  })
})

describe('Droid settings tracking', () => {
  const full = {
    modelId: 'm1',
    interactionMode: 'auto',
    autonomyLevel: 'medium',
    availableAutonomyLevels: ['off', 'low', 'medium']
  }

  it('merges a partial report over the earlier ones instead of replacing them', () => {
    const settings = new DroidReportedSettings()
    settings.receive({ settings: full })
    settings.receive({ settings: { specModeModelId: 'm2', availableAutonomyLevels: ['off'] } })
    expect(settings.current).toEqual({
      modelId: 'm1',
      interactionMode: 'auto',
      autonomyLevel: 'medium',
      availableAutonomyLevels: ['off'],
      specModeModelId: 'm2'
    })
  })

  it('takes the settings an initialize result repeats, whichever arrived first', () => {
    const settings = new DroidReportedSettings()
    settings.adopt({ autonomyLevel: 'low', modelId: 'm1' })
    settings.receive({ settings: { autonomyLevel: 'medium' } })
    settings.adopt({ autonomyLevel: 'medium', modelId: 'm1' })
    expect(settings.current).toEqual({ autonomyLevel: 'medium', modelId: 'm1' })
  })

  it('answers a request with the settings as they stood when its own report arrived', () => {
    const settings = new DroidReportedSettings()
    settings.receive({ settings: full })
    settings.receive({ requestId: 'orca-2', settings: { interactionMode: 'spec' } })
    settings.receive({ settings: { interactionMode: 'auto' } })
    expect(settings.answerTo('orca-2')).toMatchObject({ interactionMode: 'spec', modelId: 'm1' })
    expect(settings.current.interactionMode).toBe('auto')
  })

  it('answers a request once, and has no answer for one that was never reported', () => {
    const settings = new DroidReportedSettings()
    settings.receive({ requestId: 'orca-2', settings: full })
    expect(settings.answerTo('orca-3')).toBeUndefined()
    expect(settings.answerTo('orca-2')).toBeDefined()
    expect(settings.answerTo('orca-2')).toBeUndefined()
  })
})
