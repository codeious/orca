import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  agentSessionAccountHome,
  type LegacyAgentSessionAccountHome
} from '../../shared/agent-session/lifecycle/agent-session-account-home'
import { DROID_AGENT } from './droid-agent-definition'

/** Droid reads its account from HOME and honours no variable that moves it; the pin is a label. */
export function resolveDroidAccountHome({
  launchEnv
}: {
  launchEnv: NodeJS.ProcessEnv
}): LegacyAgentSessionAccountHome {
  const home = launchEnv.HOME?.trim() || launchEnv.USERPROFILE?.trim() || homedir()
  return agentSessionAccountHome(DROID_AGENT, join(home, '.factory'))
}
