import {
  getNativeChatAgentProfile,
  getTextDrivenNativeChatCommands
} from '../../native-chat/native-chat-agent-profiles'
import type { AgentType } from '../../agent-status/contracts/agent-status-types'
import {
  sessionSlashCommandSuggestions,
  type SlashCommandSuggestion
} from '../../native-chat/input/commands/native-chat-slash-commands'
import type { AgentSessionConversationCommand } from '../agent-session-conversation-command'
import type { AgentSessionSlashCommand } from '../agent-session-wire'

const COMPACT_INSTRUCTIONS_HINT = '[instructions]'

export const CONVERSATION_COMMANDS: readonly SlashCommandSuggestion[] = [
  { name: 'clear', description: 'Clear conversation context' },
  { name: 'compact', description: 'Compact conversation context' }
]

/** Orca's MCP panel, offered where the host manages this agent's servers. */
export const STRUCTURED_AGENT_SESSION_MCP_COMMAND: SlashCommandSuggestion = {
  name: 'mcp',
  description: 'Manage MCP servers',
  orcaOwned: true
}

/** Session options remain available on hosts predating conversation commands. */
export const STRUCTURED_AGENT_SESSION_SLASH_COMMANDS: readonly SlashCommandSuggestion[] = [
  { name: 'model', description: 'Choose the model' },
  { name: 'effort', description: 'Choose reasoning effort' }
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

const SESSION_ACTION_ROWS: Readonly<Record<'rename', SlashCommandSuggestion>> = {
  rename: {
    name: 'rename',
    description: 'Rename this chat',
    argumentHint: '<name>',
    orcaOwned: true
  }
}

/** The agent's names for offered conversation commands, and the session actions this client runs. */
function agentCommandRows(
  agent: AgentType,
  conversationCommands: readonly AgentSessionConversationCommand[] | undefined,
  sessionActions: boolean
): SlashCommandSuggestion[] {
  const profile = getNativeChatAgentProfile(agent)
  return [
    ...Object.entries(profile?.conversationCommandAliases ?? {}).flatMap(([name, command]) => {
      const target = CONVERSATION_COMMANDS.find((entry) => entry.name === command)
      return target && conversationCommands?.includes(command) ? [{ ...target, name }] : []
    }),
    ...(sessionActions
      ? (profile?.sessionActions ?? []).map((name) => SESSION_ACTION_ROWS[name])
      : [])
  ]
}

/** Host commands remain first; reported catalogs add other names. */
export function structuredSessionSlashCommands(
  agent: AgentType,
  conversationCommands: readonly AgentSessionConversationCommand[] | undefined,
  reported: readonly AgentSessionSlashCommand[] | undefined,
  compactInstructions?: boolean,
  interactionModeSupported = false,
  mcpPanel = false,
  sessionActions = false
): readonly SlashCommandSuggestion[] {
  const modeCommands: SlashCommandSuggestion[] = interactionModeSupported
    ? [
        { name: 'plan', description: 'Switch to Plan mode', orcaOwned: true },
        ...(agent === 'codex'
          ? [{ name: 'default', description: 'Switch to Build mode', orcaOwned: true as const }]
          : [])
      ]
    : []
  const orcaOwned = [...modeCommands, ...(mcpPanel ? [STRUCTURED_AGENT_SESSION_MCP_COMMAND] : [])]
  const offeredFirst = [
    ...orcaOwned,
    ...structuredSlashCommands(conversationCommands, agent, compactInstructions).filter(
      ({ name }) => !orcaOwned.some((entry) => entry.name === name)
    )
  ]
  const hostOwned = [
    ...offeredFirst,
    ...agentCommandRows(agent, conversationCommands, sessionActions).filter(
      ({ name }) => !offeredFirst.some((entry) => entry.name === name)
    )
  ]
  if (reported === undefined) {
    return hostOwned
  }
  const offered = new Set(hostOwned.map(({ name }) => name))
  return [
    ...hostOwned,
    ...sessionSlashCommandSuggestions(agent, reported).filter(({ name }) => !offered.has(name))
  ]
}
