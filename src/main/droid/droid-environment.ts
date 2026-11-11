import { usesIsolatedProfile } from '../../shared/electron-isolated-profile-switches'

/** An isolated profile (an e2e or QA run) must not read or write the login keychain, which Droid
 *  would otherwise prompt for. A real profile keeps it: that is where Droid keeps its sign-in. */
export function droidKeyringEnvironment(
  orcaEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  return usesIsolatedProfile(orcaEnv) ? { FACTORY_DISABLE_KEYRING: '1' } : {}
}
