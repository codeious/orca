import { describe, expect, it } from 'vitest'
import {
  DROID_AUTONOMY_LEVELS,
  droidAutonomyLevelFromSavedOptions,
  nextDroidAutonomyLevel
} from './droid-autonomy-options'

describe('the level Ctrl+L moves to', () => {
  it('walks Off, Low, Medium, High and wraps from High to Off', () => {
    const walked: string[] = []
    let level = nextDroidAutonomyLevel(DROID_AUTONOMY_LEVELS, 'off')
    for (let step = 0; step < 4; step += 1) {
      walked.push(level ?? 'none')
      level = nextDroidAutonomyLevel(DROID_AUTONOMY_LEVELS, level)
    }

    expect(walked).toEqual(['low', 'medium', 'high', 'off'])
  })

  it('wraps inside the levels Droid offers, whatever order it lists them in', () => {
    expect(nextDroidAutonomyLevel(['low', 'off'], 'off')).toBe('low')
    expect(nextDroidAutonomyLevel(['low', 'off'], 'low')).toBe('off')
  })

  it('moves to the next offered level when the current one is not offered', () => {
    expect(nextDroidAutonomyLevel(['off', 'low'], 'high')).toBe('off')
    expect(nextDroidAutonomyLevel(['off', 'high'], 'medium')).toBe('high')
  })

  it('starts at the lowest offered level when no level is known', () => {
    expect(nextDroidAutonomyLevel(DROID_AUTONOMY_LEVELS, undefined)).toBe('off')
  })

  it('names nothing when no level is offered', () => {
    expect(nextDroidAutonomyLevel([], 'low')).toBeUndefined()
  })
})

describe('the level a chat saved for its next start', () => {
  it('reads a saved level', () => {
    expect(droidAutonomyLevelFromSavedOptions({ autonomyLevel: 'low', model: 'main' })).toBe('low')
  })

  it('ignores a level Droid does not define, and an absent one', () => {
    expect(droidAutonomyLevelFromSavedOptions({ autonomyLevel: 'ultra' })).toBeUndefined()
    expect(droidAutonomyLevelFromSavedOptions({ model: 'main' })).toBeUndefined()
    expect(droidAutonomyLevelFromSavedOptions(undefined)).toBeUndefined()
  })
})
