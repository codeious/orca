import type { AgentSessionSlashCommand } from '../../shared/agent-session/agent-session-wire'

export const DROID_TEXT_COMMANDS: AgentSessionSlashCommand[] = [
  { name: 'context', kind: 'command', hostCommand: true, description: 'Show context usage' },
  { name: 'cost', kind: 'command', hostCommand: true, description: 'Show session credits' },
  { name: 'help', kind: 'command', hostCommand: true, description: 'Show available chat commands' }
]
