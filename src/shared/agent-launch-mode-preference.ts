import type { TuiAgent } from './tui-agent'
import { isTuiAgent } from './tui-agent-config'

/** `follow` defers to the Chat UI switch. */
export type AgentLaunchModePreference = 'follow' | 'terminal' | 'chat'

type StoredAgentLaunchMode = Exclude<AgentLaunchModePreference, 'follow'>

/** Keyed by agent id. An agent with no entry follows the switch, so `follow` is never stored. */
export type AgentLaunchModePreferences = Partial<Record<TuiAgent, StoredAgentLaunchMode>>

function isStoredLaunchMode(value: unknown): value is StoredAgentLaunchMode {
  return value === 'terminal' || value === 'chat'
}

export function normalizeAgentLaunchModePreferences(value: unknown): AgentLaunchModePreferences {
  const normalized: AgentLaunchModePreferences = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return normalized
  }
  for (const [agent, preference] of Object.entries(value)) {
    if (isTuiAgent(agent) && isStoredLaunchMode(preference)) {
      normalized[agent] = preference
    }
  }
  return normalized
}

/** The map after `agent` is set to `preference`; Follow removes the entry because it is never stored. */
export function withAgentLaunchModePreference(
  current: AgentLaunchModePreferences | undefined,
  agent: TuiAgent,
  preference: AgentLaunchModePreference
): AgentLaunchModePreferences {
  const { [agent]: _replaced, ...others } = current ?? {}
  return preference === 'follow' ? others : { ...others, [agent]: preference }
}

/** Total over untrusted settings: anything but a stored Terminal or Chat for a known agent follows the switch. */
export function agentLaunchModePreference(
  settings: { agentLaunchModes?: unknown } | null | undefined,
  agent: string | undefined
): AgentLaunchModePreference {
  if (!agent || !isTuiAgent(agent)) {
    return 'follow'
  }
  return normalizeAgentLaunchModePreferences(settings?.agentLaunchModes)[agent] ?? 'follow'
}
