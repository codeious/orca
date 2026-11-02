import type { AgentSessionSlashCommand } from '../../shared/agent-session/agent-session-wire'

export const DROID_TEXT_COMMANDS: AgentSessionSlashCommand[] = [
  {
    name: 'mcp',
    kind: 'command',
    hostCommand: true,
    description: 'List MCP servers; sign-in, enable, disable, add or remove a server'
  },
  {
    name: 'skills',
    kind: 'command',
    hostCommand: true,
    description: 'List skills; enable or disable a skill'
  },
  { name: 'context', kind: 'command', hostCommand: true, description: 'Show context usage' },
  { name: 'cost', kind: 'command', hostCommand: true, description: 'Show session credits' },
  { name: 'help', kind: 'command', hostCommand: true, description: 'Show available chat commands' }
]
