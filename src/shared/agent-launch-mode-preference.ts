import type { TuiAgent } from './tui-agent'
import { isTuiAgent } from './tui-agent-config'

/** `follow` defers to the Chat UI switch. */
export type AgentLaunchModePreference = 'follow' | 'terminal' | 'chat'

/** Keyed by agent id. An agent with no entry follows the switch, so `follow` is never stored. */
export type AgentLaunchModePreferences = Partial<
  Record<TuiAgent, Exclude<AgentLaunchModePreference, 'follow'>>
>

export function normalizeAgentLaunchModePreferences(value: unknown): AgentLaunchModePreferences {
  const normalized: AgentLaunchModePreferences = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return normalized
  }
  for (const [agent, preference] of Object.entries(value)) {
    if (isTuiAgent(agent) && (preference === 'terminal' || preference === 'chat')) {
      normalized[agent] = preference
    }
  }
  return normalized
}

export function agentLaunchModePreference(
  settings: { agentLaunchModes?: AgentLaunchModePreferences } | null | undefined,
  agent: string | undefined
): AgentLaunchModePreference {
  if (!agent || !isTuiAgent(agent)) {
    return 'follow'
  }
  return settings?.agentLaunchModes?.[agent] ?? 'follow'
}
