import {
  getAgentSessionOptionCatalog,
  type AgentSessionOptionCatalog
} from './agent-session-option-catalog'
import { isAgentSessionHandleProvider } from './agent-session-provider-handle'

// Over `agentSession.*` only the live read and `setOption` apply a pick, so no launch apply is named.
const LIVE_ONLY_CATALOG: AgentSessionOptionCatalog = { models: [], modelApply: {} }
// Droid takes its mode in `droid.initialize_session`, so Spec is a pick before the first message.
const DROID_SEED_CATALOG: AgentSessionOptionCatalog = {
  ...LIVE_ONLY_CATALOG,
  offersSpecAtRest: true
}

/**
 * What a structured chat's picker shows, on desktop and phone alike, before the host catalog or the
 * session answers: one fallback rule for every agent. The agents every build ships a structured
 * seed for start from that built-in list (presentation only; it never makes a launch pick); any
 * other agent's terminal catalog names CLI flags its structured session never offered, so it starts
 * from the provider-default placeholder instead.
 */
export function structuredAgentSessionSeedCatalog(agent: string): AgentSessionOptionCatalog {
  if (agent === 'droid') {
    return DROID_SEED_CATALOG
  }
  return isAgentSessionHandleProvider(agent)
    ? (getAgentSessionOptionCatalog(agent) ?? LIVE_ONLY_CATALOG)
    : LIVE_ONLY_CATALOG
}
