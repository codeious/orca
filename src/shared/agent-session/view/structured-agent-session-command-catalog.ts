import {
  getNativeChatAgentProfile,
  getTextDrivenNativeChatCommands
} from '../../native-chat/native-chat-agent-profiles'
import type { AgentType } from '../../agent-status-types'
import {
  sessionSlashCommandSuggestions,
  type SlashCommandSuggestion
} from '../../native-chat/input/native-chat-slash-commands'
import type { AgentSessionConversationCommand } from '../agent-session-conversation-command'
import type { AgentSessionSlashCommand } from '../agent-session-wire'
const MODEL_COMMAND: SlashCommandSuggestion = {
  name: 'model',
  description: 'Choose the model'
}

const EFFORT_COMMAND: SlashCommandSuggestion = {
  name: 'effort',
  description: 'Choose reasoning effort'
}

const COMPACT_INSTRUCTIONS_HINT = '[instructions]'

export const CONVERSATION_COMMANDS: readonly SlashCommandSuggestion[] = [
  { name: 'clear', description: 'Clear conversation context' },
  { name: 'compact', description: 'Compact conversation context' }
]

/** Session options remain available on hosts predating conversation commands. */
export const STRUCTURED_AGENT_SESSION_SLASH_COMMANDS: readonly SlashCommandSuggestion[] = [
  MODEL_COMMAND,
  EFFORT_COMMAND
]

/** Fallback menu combines host-owned and agent text-driven commands when no catalog is reported. */
export function structuredSlashCommands(
  commands: readonly AgentSessionConversationCommand[] = [],
  agent?: AgentType | null,
  compactInstructions = false
): readonly SlashCommandSuggestion[] {
  const hostOwned = [
    ...STRUCTURED_AGENT_SESSION_SLASH_COMMANDS,
    ...CONVERSATION_COMMANDS.filter((entry) =>
      commands.includes(entry.name as AgentSessionConversationCommand)
    ).map((entry) =>
      entry.name === 'compact' && compactInstructions
        ? { ...entry, argumentHint: COMPACT_INSTRUCTIONS_HINT }
        : entry
    )
  ]
  // No reported catalog must not hide agent-handled commands such as Codex /goal.
  return [
    ...hostOwned,
    ...getTextDrivenNativeChatCommands(agent).filter(
      (entry) => !hostOwned.some((offered) => offered.name === entry.name)
    )
  ]
}

/** Host commands remain first; reported catalogs add other names. */
export function structuredSessionSlashCommands(
  agent: AgentType,
  conversationCommands: readonly AgentSessionConversationCommand[] | undefined,
  reported: readonly AgentSessionSlashCommand[] | undefined,
  compactInstructions = false,
  sessionActions = true
): readonly SlashCommandSuggestion[] {
  const hostOwned = structuredSlashCommands(conversationCommands, agent, compactInstructions)
  const profile = getNativeChatAgentProfile(agent)
  const extra = [
    ...Object.entries(profile?.conversationCommandAliases ?? {})
      .filter(([, command]) => conversationCommands?.includes(command))
      .map(([name]) => ({ name })),
    ...(sessionActions ? (profile?.sessionActions ?? []).map((name) => ({ name })) : [])
  ]
  if (reported === undefined) {
    return [...hostOwned, ...extra]
  }
  const offered = new Set(hostOwned.map(({ name }) => name))
  return [
    ...hostOwned,
    ...extra,
    ...sessionSlashCommandSuggestions(agent, reported).filter(({ name }) => !offered.has(name))
  ]
}
