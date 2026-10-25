import { describe, expect, it } from 'vitest'
import { DROID_CHAT_VERSION_FLOOR as SHARED_FLOOR } from '../../shared/droid-chat-version-floor'
import {
  DROID_CHAT_VERSION_FLOOR,
  isSupportedDroidProtocol,
  isSupportedDroidVersion,
  unsupportedDroidRelease
} from './droid-version-support'

describe('unsupportedDroidRelease', () => {
  it('names a stable release below the floor, with what to run to update it', () => {
    expect(unsupportedDroidRelease('0.230.0')).toEqual({
      agentName: 'Droid',
      found: '0.230.0',
      floor: '0.238.0',
      updateCommand: 'droid update'
    })
  })

  it.each(['0.238.0', '0.249.0', '1.0.0', '0.237.0-beta.1', '0.249.0-beta.1', 'not a version'])(
    'names nothing for %s: at or past the floor, a prerelease, or no release at all',
    (version) => {
      expect(unsupportedDroidRelease(version)).toBeNull()
    }
  )
})

describe('isSupportedDroidVersion', () => {
  it('names 0.238.0 as the oldest release the chat supports', () => {
    expect(DROID_CHAT_VERSION_FLOOR).toBe('0.238.0')
  })

  it('checks against the same floor the settings words name', () => {
    expect(DROID_CHAT_VERSION_FLOOR).toBe(SHARED_FLOOR)
    expect(isSupportedDroidVersion(SHARED_FLOOR)).toBe(true)
  })

  it.each([
    ['0.238.0', true],
    ['0.249.0', true],
    ['0.1000.0', true],
    ['1.0.0', true],
    ['0.237.9', false],
    ['0.230.0', false],
    ['0.249.0-beta.1', false],
    ['0.238.0-rc.1', false]
  ])('reads %s as supported=%s', (version, supported) => {
    expect(isSupportedDroidVersion(version)).toBe(supported)
  })
})

describe('isSupportedDroidProtocol', () => {
  it.each([
    ['1.275.0', true],
    ['1.201.1', true],
    ['1.0.0', true],
    ['2.0.0', false],
    ['0.9.0', false],
    ['', false],
    ['one', false],
    ['1', false]
  ])('reads protocol %j as supported=%s', (protocol, supported) => {
    expect(isSupportedDroidProtocol(protocol)).toBe(supported)
  })
})
