import { describe, expect, it } from 'vitest'
import { applyDroidTerminalEnvironment, droidKeyringEnvironment } from './droid-environment'

describe('droidKeyringEnvironment', () => {
  it('keeps Droid off the login keychain when Orca runs in an isolated profile', () => {
    expect(droidKeyringEnvironment({ ORCA_E2E_USER_DATA_DIR: '/tmp/e2e' })).toEqual({
      FACTORY_DISABLE_KEYRING: '1'
    })
    expect(droidKeyringEnvironment({ ORCA_E2E_HOME_DIR: '/tmp/e2e-home' })).toEqual({
      FACTORY_DISABLE_KEYRING: '1'
    })
  })

  it('leaves a real profile on the keychain Droid signed in with', () => {
    expect(droidKeyringEnvironment({ HOME: '/Users/me' })).toEqual({})
  })
})

describe('applyDroidTerminalEnvironment', () => {
  const isolated = { ORCA_E2E_HOME_DIR: '/tmp/e2e-home' }

  it.each([
    ['a launch Orca knows is Droid', { launchAgent: 'droid' }],
    ['a command line that starts Droid', { launchCommand: 'droid --auto high' }],
    ['a Droid path', { launchCommand: '/opt/factory/bin/droid' }]
  ])('keeps %s off the login keychain in an isolated profile', (_name, launch) => {
    const env: Record<string, string> = { PATH: '/usr/bin' }

    applyDroidTerminalEnvironment(env, launch, isolated)

    expect(env).toEqual({ PATH: '/usr/bin', FACTORY_DISABLE_KEYRING: '1' })
  })

  it.each([
    ['a real profile', { launchAgent: 'droid' }, {}],
    ['another agent', { launchAgent: 'claude' }, isolated],
    ['another agent named by its command', { launchCommand: 'claude --resume' }, isolated],
    ['a bare shell', {}, isolated],
    [
      'a WSL guest, whose keychain is not the host one',
      { launchAgent: 'droid', isWsl: true },
      isolated
    ]
  ])('leaves %s alone', (_name, launch, orcaEnv) => {
    const env: Record<string, string> = { PATH: '/usr/bin' }

    applyDroidTerminalEnvironment(env, launch, orcaEnv)

    expect(env).toEqual({ PATH: '/usr/bin' })
  })
})
