import { describe, expect, it } from 'vitest'
import { resolveTuiAgentLaunchArgs } from '../../shared/tui-agent-launch-defaults'
import { tokenizeStartupCommand } from '../../shared/tui-agent-startup-shell'
import {
  droidAutonomyLevelFromLaunchArgs,
  droidAutonomyLowerThanAsked
} from './droid-autonomy-level'

const level = (args: string) => {
  const parsed = tokenizeStartupCommand(args, 'posix')
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  return droidAutonomyLevelFromLaunchArgs(parsed.tokens)
}

describe('Droid autonomy from the Agent Permissions arguments', () => {
  it('reads an untouched setting as high, because Orca ships Yolo', () => {
    expect(level(resolveTuiAgentLaunchArgs('droid', undefined))).toBe('high')
    expect(level(resolveTuiAgentLaunchArgs('droid', {}))).toBe('high')
  })

  it('reads Yolo as high and Manual (stored as an empty string) as off', () => {
    expect(level(resolveTuiAgentLaunchArgs('droid', { droid: '--auto high' }))).toBe('high')
    expect(level(resolveTuiAgentLaunchArgs('droid', { droid: '' }))).toBe('off')
  })

  it('reads the level an edited argument string names', () => {
    expect(level('--auto low')).toBe('low')
    expect(level('--model x --auto medium')).toBe('medium')
    expect(level('--auto=medium')).toBe('medium')
  })

  it('counts --skip-permissions-unsafe as high', () => {
    expect(level('--skip-permissions-unsafe')).toBe('high')
  })

  it('reads arguments that name no level as off', () => {
    expect(level('--model gpt-6')).toBe('off')
  })

  it('reads a level Droid does not know as off rather than guessing', () => {
    expect(level('--auto ultra')).toBe('off')
    expect(level('--auto')).toBe('off')
  })

  it('lets an explicit --auto beat --skip-permissions-unsafe, and the last --auto win', () => {
    expect(level('--skip-permissions-unsafe --auto low')).toBe('low')
    expect(level('--auto low --auto medium')).toBe('medium')
  })
})

describe('Droid autonomy below what was asked', () => {
  it('is true only for a reported level under the asked one', () => {
    expect(droidAutonomyLowerThanAsked('medium', 'high')).toBe(true)
    expect(droidAutonomyLowerThanAsked('off', 'low')).toBe(true)
    expect(droidAutonomyLowerThanAsked('high', 'high')).toBe(false)
    expect(droidAutonomyLowerThanAsked('high', 'medium')).toBe(false)
  })
})
