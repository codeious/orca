import { describe, expect, it } from 'vitest'
import { droidKeyringEnvironment } from './droid-environment'

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
