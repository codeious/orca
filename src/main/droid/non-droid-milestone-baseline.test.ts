import { describe, expect, it } from 'vitest'
import type { AgentType } from '../../shared/agent-status-types'
import type { AgentSessionCapabilities } from '../../shared/agent-session-capabilities'
import { getVerifiedNativeChatCommands } from '../../shared/native-chat-agent-profiles'
import {
  sessionReportedSkillNames,
  sessionSlashCommandSuggestions,
  type SlashCommandSuggestion
} from '../../shared/native-chat-slash-commands'
import { structuredSlashCommands } from '../../shared/structured-agent-session-composer'
import type { AgentSessionSlashCommand } from '../../shared/agent-session-wire'
import { ACP_LAUNCH_SPECS } from '../acp/acp-launch-specs'
import { acpStructuredAgentDefinition } from '../acp/acp-structured-agent-definitions'
import { CLAUDE_STRUCTURED_AGENT } from '../claude/claude-structured-agent-definition'
import { CODEX_STRUCTURED_AGENT } from '../codex/codex-structured-agent-definition'
import { PI_RPC_AGENT } from '../pi/rpc-agent-definition'

// VAL-PARCROSS-002: literals read with git show 74b4deb9dc:<path>, not from the current catalogs.
const OPTION_MENU = [
  { name: 'model', description: 'Choose the model' },
  { name: 'effort', description: 'Choose reasoning effort' }
]
const CONVERSATION_MENU = [
  { name: 'model', description: 'Choose the model' },
  { name: 'effort', description: 'Choose reasoning effort' },
  { name: 'clear', description: 'Clear conversation context' },
  { name: 'compact', description: 'Compact conversation context' }
]
const CODEX_OPTION_MENU = [
  { name: 'model', description: 'Choose the model' },
  { name: 'effort', description: 'Choose reasoning effort' },
  { name: 'goal', description: 'Set or view the goal' }
]
const CODEX_CONVERSATION_MENU = [
  { name: 'model', description: 'Choose the model' },
  { name: 'effort', description: 'Choose reasoning effort' },
  { name: 'clear', description: 'Clear conversation context' },
  { name: 'compact', description: 'Compact conversation context' },
  { name: 'goal', description: 'Set or view the goal' }
]

type MenuBaseline = {
  agent: AgentType
  options: readonly SlashCommandSuggestion[]
  conversation: readonly SlashCommandSuggestion[]
  terminal: readonly string[]
}

const MENUS: readonly MenuBaseline[] = [
  {
    agent: 'claude',
    options: OPTION_MENU,
    conversation: CONVERSATION_MENU,
    terminal: ['clear', 'compact', 'init', 'review', 'help']
  },
  {
    agent: 'openclaude',
    options: OPTION_MENU,
    conversation: CONVERSATION_MENU,
    terminal: ['clear', 'compact', 'init', 'review', 'help', 'context']
  },
  {
    agent: 'codex',
    options: CODEX_OPTION_MENU,
    conversation: CODEX_CONVERSATION_MENU,
    terminal: [
      'model',
      'ide',
      'permissions',
      'keymap',
      'vim',
      'experimental',
      'approve',
      'memories',
      'skills',
      'import',
      'hooks',
      'review',
      'rename',
      'new',
      'archive',
      'delete',
      'resume',
      'fork',
      'app',
      'init',
      'compact',
      'plan',
      'goal',
      'agent',
      'side',
      'copy',
      'raw',
      'diff',
      'mention',
      'status',
      'usage',
      'title',
      'statusline',
      'theme',
      'pets',
      'mcp',
      'plugins',
      'logout',
      'exit',
      'feedback',
      'ps',
      'stop',
      'clear',
      'personality',
      'subagents'
    ]
  },
  {
    agent: 'omp',
    options: OPTION_MENU,
    conversation: CONVERSATION_MENU,
    terminal: [
      'model',
      'switch',
      'plan',
      'compact',
      'clear',
      'new',
      'resume',
      'fork',
      'branch',
      'tree',
      'session',
      'rename',
      'context',
      'usage',
      'fast',
      'tools',
      'jobs',
      'git',
      'export',
      'settings',
      'extensions',
      'hotkeys'
    ]
  },
  {
    agent: 'pi',
    options: OPTION_MENU,
    conversation: CONVERSATION_MENU,
    terminal: ['clear', 'help']
  },
  {
    agent: 'grok',
    options: OPTION_MENU,
    conversation: CONVERSATION_MENU,
    terminal: []
  },
  {
    agent: 'opencode',
    options: OPTION_MENU,
    conversation: CONVERSATION_MENU,
    terminal: ['clear', 'help']
  }
]

describe('VAL-PARCROSS-002: non-Droid menus at 74b4deb9dc', () => {
  it.each(MENUS)('keeps the full $agent slash menu on hosts without a catalog', (baseline) => {
    expect(structuredSlashCommands([], baseline.agent)).toEqual(baseline.options)
    expect(structuredSlashCommands(['clear', 'compact'], baseline.agent)).toEqual(
      baseline.conversation
    )
  })

  it.each(MENUS)(
    'keeps the $agent reported menu authoritative, including an empty one',
    ({ agent }) => {
      const reported: AgentSessionSlashCommand[] = [
        {
          name: 'workspace-check',
          kind: 'command',
          description: 'Check this workspace',
          argumentHint: '<target>'
        },
        { name: 'workspace-skill', kind: 'skill' }
      ]
      expect(sessionSlashCommandSuggestions(agent, reported)).toEqual([
        { name: 'workspace-check', description: 'Check this workspace', argumentHint: '<target>' }
      ])
      expect(sessionReportedSkillNames(reported)).toEqual(['workspace-skill'])
      expect(sessionSlashCommandSuggestions(agent, [])).toEqual([])
      expect(sessionReportedSkillNames([])).toEqual([])
    }
  )

  it.each(MENUS)(
    'keeps the complete $agent curated terminal catalog in order',
    ({ agent, terminal }) => {
      expect(getVerifiedNativeChatCommands(agent).map(({ name }) => name)).toEqual(terminal)
    }
  )
})

const DEFINITIONS = [
  CLAUDE_STRUCTURED_AGENT,
  CODEX_STRUCTURED_AGENT,
  PI_RPC_AGENT,
  ...ACP_LAUNCH_SPECS.map(acpStructuredAgentDefinition)
]
const ACCEPTED_KEYS: Readonly<Record<string, readonly string[]>> = {
  claude: ['model', 'effort', 'permissionMode', 'fastMode'],
  codex: ['model', 'effort', 'approvalsReviewer', 'personality', 'serviceTier'],
  pi: ['model', 'effort'],
  grok: ['model', 'effort'],
  opencode: ['model', 'effort'],
  omp: ['model', 'effort']
}
const OPTION_PROBES = [
  'model',
  'effort',
  'permissionMode',
  'fastMode',
  'approvalsReviewer',
  'personality',
  'serviceTier',
  'planMode',
  'specModel',
  'specEffort',
  'autonomyLevel',
  'availableAutonomyLevels',
  'unknown-option',
  '',
  'Model',
  ' model',
  'model '
]

describe('VAL-PARCROSS-002: non-Droid option admission at 74b4deb9dc', () => {
  it('covers every shipped ACP definition and the three native structured definitions', () => {
    expect(DEFINITIONS.map(({ agent }) => agent)).toEqual([
      'claude',
      'codex',
      'pi',
      'grok',
      'opencode',
      'omp'
    ])
  })

  it.each(DEFINITIONS)(
    '$agent accepts exactly its baseline keys and rejects Droid-only keys',
    (definition) => {
      const accepted = ACCEPTED_KEYS[definition.agent]
      expect(accepted).toBeDefined()
      expect(OPTION_PROBES.filter((key) => definition.restingOptions.acceptsKey(key))).toEqual(
        accepted
      )
    }
  )
})

const CAPABILITIES: Readonly<Record<string, AgentSessionCapabilities>> = {
  claude: {
    rewind: false,
    compact: true,
    threadGoal: false,
    contextUsage: true,
    imagePrompts: true,
    steering: 'inject',
    approvalEnforcement: 'provider'
  },
  codex: {
    rewind: true,
    compact: true,
    threadGoal: true,
    contextUsage: false,
    imagePrompts: true,
    steering: 'inject',
    approvalEnforcement: 'provider'
  },
  pi: {
    rewind: false,
    compact: true,
    threadGoal: false,
    contextUsage: true,
    imagePrompts: true,
    steering: 'inject',
    approvalEnforcement: 'provider'
  },
  grok: {
    rewind: false,
    compact: true,
    threadGoal: false,
    contextUsage: true,
    imagePrompts: false,
    steering: 'queue',
    approvalEnforcement: 'orca'
  },
  opencode: {
    rewind: false,
    compact: true,
    threadGoal: false,
    contextUsage: true,
    imagePrompts: true,
    steering: 'queue',
    approvalEnforcement: 'orca'
  },
  omp: {
    rewind: false,
    compact: true,
    threadGoal: false,
    contextUsage: true,
    imagePrompts: false,
    steering: 'queue',
    approvalEnforcement: 'orca'
  }
}

describe('VAL-PARCROSS-002: non-Droid capability flags at 74b4deb9dc', () => {
  it.each(DEFINITIONS)('keeps the complete $agent capability object', ({ agent, capabilities }) => {
    expect(capabilities).toStrictEqual(CAPABILITIES[agent])
  })
})
