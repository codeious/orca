import { describe, expect, it } from 'vitest'
import {
  DROID_NEW_SESSION_SETTINGS,
  droidFreshSessionOptionPicks,
  droidSettingsKeptByClear
} from './droid-fresh-session-settings'
import type {
  SessionOptionDescriptor,
  SessionOptionValueSource,
  SessionOptionsSurface
} from './native-chat-session-options'

function select(
  id: string,
  currentValue: string,
  valueSource: SessionOptionValueSource = 'reported'
): SessionOptionDescriptor {
  return {
    id,
    label: id,
    kind: { type: 'select', currentValue, choices: [] },
    valueSource,
    transport: 'agent-session',
    settable: true
  }
}

function toggle(
  id: string,
  currentValue: boolean,
  valueSource: SessionOptionValueSource = 'reported'
): SessionOptionDescriptor {
  return {
    id,
    label: id,
    kind: { type: 'boolean', currentValue },
    valueSource,
    transport: 'agent-session',
    settable: true
  }
}

const SURFACE: Pick<SessionOptionsSurface, 'specPair' | 'autonomy'> = {
  autonomy: { level: 'low', levels: ['off', 'low', 'medium', 'high'], settable: true },
  specPair: {
    model: 'spec-model',
    effort: 'high',
    modelChoices: [],
    effortChoices: [],
    settable: true
  }
}

describe('what /clear keeps of the tab it leaves', () => {
  it('keeps the model, effort, Spec, autonomy level and Spec model pair the tab runs on', () => {
    const snapshot = [
      select('model', 'claude-haiku-5-5'),
      select('effort', 'off'),
      toggle('planMode', true)
    ]

    expect(droidSettingsKeptByClear(snapshot, SURFACE)).toEqual({
      model: 'claude-haiku-5-5',
      effort: 'off',
      spec: true,
      autonomyLevel: 'low',
      specModel: 'spec-model',
      specEffort: 'high'
    })
  })

  it('keeps Spec being off, so a saved Spec default does not reopen it', () => {
    expect(droidSettingsKeptByClear([toggle('planMode', false)], undefined)).toEqual({
      spec: false
    })
  })

  it('leaves a Spec pair that runs on the main model to the main model, never a stand-in id', () => {
    const surface: Pick<SessionOptionsSurface, 'specPair'> = {
      specPair: {
        model: null,
        effort: null,
        modelChoices: [],
        effortChoices: [],
        settable: true
      }
    }

    expect(droidSettingsKeptByClear([select('model', 'main')], surface)).toEqual({ model: 'main' })
  })

  it('carries a Spec effort alone when only the effort was set', () => {
    const surface: Pick<SessionOptionsSurface, 'specPair'> = {
      specPair: { model: null, effort: 'low', modelChoices: [], effortChoices: [], settable: true }
    }

    expect(droidSettingsKeptByClear([], surface)).toEqual({ specEffort: 'low' })
  })

  it.each<SessionOptionValueSource>(['default', 'unknown'])(
    'leaves out a value only the catalog shows (%s): it says nothing of what is running',
    (source) => {
      const snapshot = [
        select('model', 'catalog-model', source),
        select('effort', 'high', source),
        toggle('planMode', true, source)
      ]

      expect(droidSettingsKeptByClear(snapshot, undefined)).toEqual({})
    }
  )

  it.each<SessionOptionValueSource>(['applied', 'dispatched', 'reported'])(
    'keeps a value that is %s',
    (source) => {
      expect(droidSettingsKeptByClear([select('model', 'm', source)], undefined)).toEqual({
        model: 'm'
      })
    }
  )

  it('keeps nothing of a tab that reports nothing', () => {
    expect(droidSettingsKeptByClear([], undefined)).toEqual({})
    expect(droidSettingsKeptByClear([], {})).toEqual({})
  })
})

describe('what /new starts with', () => {
  it('is Auto, with every other setting left to a newly opened chat', () => {
    expect(DROID_NEW_SESSION_SETTINGS).toEqual({ spec: false })
  })
})

describe('the picks a fresh session holds', () => {
  it('lists model, effort, Spec, the Spec pair, then autonomy, each as the host reads it', () => {
    expect(
      droidFreshSessionOptionPicks({
        autonomyLevel: 'medium',
        specEffort: 'high',
        specModel: 'spec-model',
        spec: true,
        effort: 'low',
        model: 'main-model'
      })
    ).toEqual([
      ['model', 'main-model'],
      ['effort', 'low'],
      ['planMode', 'true'],
      ['specModel', 'spec-model'],
      ['specEffort', 'high'],
      ['autonomyLevel', 'medium']
    ])
  })

  it('skips what was not given, and keeps Spec being off', () => {
    expect(droidFreshSessionOptionPicks({})).toEqual([])
    expect(droidFreshSessionOptionPicks({ spec: false })).toEqual([['planMode', 'false']])
  })
})
