import { describe, expect, it } from 'vitest'
import {
  DROID_CHAT_VERSION_FLOOR,
  isSupportedDroidProtocol,
  isSupportedDroidVersion
} from './droid-version-support'

describe('isSupportedDroidVersion', () => {
  it('names 0.238.0 as the oldest release the chat supports', () => {
    expect(DROID_CHAT_VERSION_FLOOR).toBe('0.238.0')
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
