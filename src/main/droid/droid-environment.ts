import { recognizeAgentProcessFromCommandLine } from '../../shared/agent-process-recognition'
import { usesIsolatedProfile } from '../../shared/electron-isolated-profile-switches'

/** An isolated profile (an e2e or QA run) must not read or write the login keychain, which Droid
 *  would otherwise prompt for. A real profile keeps it: that is where Droid keeps its sign-in. */
export function droidKeyringEnvironment(
  orcaEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  return usesIsolatedProfile(orcaEnv) ? { FACTORY_DISABLE_KEYRING: '1' } : {}
}

/** A terminal that launches Droid gets the same keychain rule as the structured session. A bare
 *  shell does not: the flag would reach every program the person runs in it. */
export function applyDroidTerminalEnvironment(
  baseEnv: Record<string, string>,
  launch: { launchAgent?: string; launchCommand?: string; isWsl?: boolean },
  orcaEnv: NodeJS.ProcessEnv = process.env
): void {
  if (launch.isWsl) {
    return
  }
  const agent =
    launch.launchAgent ?? recognizeAgentProcessFromCommandLine(launch.launchCommand)?.agent
  if (agent === 'droid') {
    Object.assign(baseEnv, droidKeyringEnvironment(orcaEnv))
  }
}
