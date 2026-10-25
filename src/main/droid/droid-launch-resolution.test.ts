import { describe, expect, it, vi } from 'vitest'
import {
  droidUnsupportedVersion,
  droidVersionSupported,
  resolveDroidCommand
} from './droid-launch-resolution'

const launch = { command: '/host/bin/droid', cwd: '/work', env: { PATH: '/host/bin' } }

describe('resolveDroidCommand', () => {
  it('resolves the stock droid binary from the launch PATH and home', () => {
    const resolve = vi.fn((..._input: unknown[]) => '/host/bin/droid')

    expect(resolveDroidCommand({ PATH: '/host/bin', HOME: '/home/me' }, {}, resolve)).toBe(
      '/host/bin/droid'
    )
    expect(resolve).toHaveBeenCalledWith('droid', { pathEnv: '/host/bin', homePath: '/home/me' })
  })
})

describe('droidVersionSupported', () => {
  it('asks the version probe against the floor, with the keyring policy of an isolated profile', async () => {
    const probe = vi.fn(async (_input: unknown, supports: (version: string) => boolean) => {
      expect([supports('0.238.0'), supports('0.237.0'), supports('0.250.0-beta.1')]).toEqual([
        true,
        false,
        false
      ])
      return true
    })

    await expect(
      droidVersionSupported(launch, probe, { ORCA_E2E_HOME_DIR: '/tmp/h' })
    ).resolves.toBe(true)
    expect(probe).toHaveBeenCalledWith(
      {
        program: '/host/bin/droid',
        cwd: '/work',
        env: { PATH: '/host/bin', FACTORY_DISABLE_KEYRING: '1' }
      },
      expect.any(Function)
    )
  })
})

describe('droidUnsupportedVersion', () => {
  it('names a stable release below the floor', async () => {
    const read = vi.fn(async () => '0.230.0')

    await expect(droidUnsupportedVersion(launch, read, {})).resolves.toEqual({
      agentName: 'Droid',
      found: '0.230.0',
      floor: '0.238.0',
      updateCommand: 'droid update'
    })
    expect(read).toHaveBeenCalledWith({ program: '/host/bin/droid', cwd: '/work', env: launch.env })
  })

  it.each([
    ['a supported release', '0.249.0'],
    ['a prerelease', '0.230.0-beta.1'],
    ['no readable version', null]
  ])('names nothing for %s', async (_name, version) => {
    await expect(droidUnsupportedVersion(launch, async () => version, {})).resolves.toBeNull()
  })
})
