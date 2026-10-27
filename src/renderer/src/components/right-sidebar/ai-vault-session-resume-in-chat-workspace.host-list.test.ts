import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import {
  STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RESUME_HISTORY_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  type RuntimeCapability
} from '../../../../shared/protocol-version'

// The sibling suite mocks the feasibility check; this one keeps the real route and host-agent cache.
const mocks = vi.hoisted(() => ({
  owner: vi.fn<() => string | null>(() => 'local'),
  readLocalRuntimeCapabilitiesOrUnknown: vi.fn(),
  callRuntimeRpc: vi.fn(),
  state: {
    settings: {},
    repos: [],
    worktreesByRepo: {},
    folderWorkspaces: [],
    runtimeStatusByEnvironmentId: new Map<string, never>()
  }
}))

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/runtime/structured-agent-session-owner', () => ({
  resolveStructuredAgentSessionOwner: mocks.owner
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({ getExecutionHostIdForWorktree: vi.fn() }))
vi.mock('@/lib/local-preflight-context', () => ({
  getLocalProjectExecutionRuntimeContext: vi.fn(),
  getLocalRepoProjectExecutionRuntimeContext: vi.fn()
}))
vi.mock('@/lib/web-client-location', () => ({ isWebClientLocation: () => false }))
vi.mock('@/runtime/local-runtime-capabilities', () => ({
  readLocalRuntimeCapabilitiesOrUnknown: mocks.readLocalRuntimeCapabilitiesOrUnknown
}))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.callRuntimeRpc }))
vi.mock('@/lib/structured-agent-launch-settlement', () => ({}))

import {
  loadHostStructuredAgents,
  resetHostStructuredAgentsForTests
} from '@/runtime/host-structured-agents'
import type { AgentLaunchRouteStore } from '@/lib/agent-launch-route-input'
import { resolveAgentSessionLaunchRoute } from '@/lib/agent-session-launch-plan'
import { resolveAiVaultSessionResumeInChatForWorkspace } from './ai-vault-session-resume-in-chat-workspace'

const WORKSPACE = 'repo-1::/srv/orca'
const WORKSPACE_PATH = '/srv/orca'
const OFFERING_CAPABILITIES: RuntimeCapability[] = [
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RESUME_HISTORY_RUNTIME_CAPABILITY
]
const LISTS_CLAUDE_AND_CODEX = {
  agents: [
    { agent: 'claude', capabilities: {} },
    { agent: 'codex', capabilities: {} }
  ]
}
const LISTS_DROID = {
  agents: [...LISTS_CLAUDE_AND_CODEX.agents, { agent: 'droid', capabilities: {} }]
}

function historyRow(overrides: { agent?: string; executionHostId?: string } = {}): AiVaultSession {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields eligibility reads are staged.
  return {
    id: 'history-1',
    agent: 'droid',
    executionHostId: 'local',
    cwd: WORKSPACE_PATH,
    filePath: '/Users/me/.factory/sessions/-srv-orca/history-1.jsonl',
    messageCount: 4,
    previewMessages: [],
    ...overrides
  } as unknown as AiVaultSession
}

type RowSettings = Parameters<typeof resolveAiVaultSessionResumeInChatForWorkspace>[0]['settings']

function resumeInChat(session: AiVaultSession, settings: RowSettings) {
  return resolveAiVaultSessionResumeInChatForWorkspace({
    session,
    resumeState: { blocked: true, worktreeId: null, usesSessionWorktree: false },
    activeWorkspaceId: WORKSPACE,
    targetState: {
      folderWorkspaces: [],
      projectGroups: [],
      repos: [],
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the path lookup reads id and path only.
      worktreesByRepo: { 'repo-1': [{ id: WORKSPACE, path: WORKSPACE_PATH }] } as never
    },
    settings,
    droidHolder: null
  })
}

const OFFERED = { available: true, workspaceId: WORKSPACE }
const CHAT_OFF_TERMINAL: RowSettings = {
  experimentalNativeChat: false,
  agentLaunchModes: { droid: 'terminal' }
}

beforeEach(() => {
  resetHostStructuredAgentsForTests()
  mocks.owner.mockReset().mockReturnValue('local')
  mocks.callRuntimeRpc.mockReset().mockResolvedValue(LISTS_DROID)
  mocks.readLocalRuntimeCapabilitiesOrUnknown.mockReset().mockReturnValue(OFFERING_CAPABILITIES)
  mocks.state.settings = CHAT_OFF_TERMINAL
})

describe('resuming a local Droid conversation in a chat before the host listed its agents', () => {
  // Follow is the default, so settings store it as no entry at all.
  it.each([
    ['Terminal', { droid: 'terminal' }],
    ['Follow', {}]
  ] as const)('is offered with the Chat UI switch off and Launch mode %s', (_label, modes) => {
    expect(
      resumeInChat(historyRow(), { experimentalNativeChat: false, agentLaunchModes: modes })
    ).toEqual(OFFERED)
  })

  it('asks the host for nothing to decide it', () => {
    resumeInChat(historyRow(), CHAT_OFF_TERMINAL)

    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('still needs a host that registers agents', () => {
    mocks.readLocalRuntimeCapabilitiesOrUnknown.mockReturnValue([
      STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
      STRUCTURED_AGENT_SESSION_RESUME_HISTORY_RUNTIME_CAPABILITY
    ])

    expect(resumeInChat(historyRow(), CHAT_OFF_TERMINAL)).toEqual({
      available: false,
      reason: 'workspace'
    })
  })

  it('follows a list the host gave, so a Droid it left out is not offered', async () => {
    mocks.callRuntimeRpc.mockResolvedValue(LISTS_CLAUDE_AND_CODEX)
    await loadHostStructuredAgents('local', OFFERING_CAPABILITIES, null)

    expect(resumeInChat(historyRow(), CHAT_OFF_TERMINAL)).toEqual({
      available: false,
      reason: 'workspace'
    })
  })

  it('is offered from a list that names Droid', async () => {
    await loadHostStructuredAgents('local', OFFERING_CAPABILITIES, null)

    expect(resumeInChat(historyRow(), CHAT_OFF_TERMINAL)).toEqual(OFFERED)
  })

  it('leaves an agent that is not adopted from history alone', () => {
    expect(resumeInChat(historyRow({ agent: 'grok' }), CHAT_OFF_TERMINAL)).toEqual({
      available: false,
      reason: 'agent'
    })
  })

  it("is not offered for a conversation recorded on a paired server's host", () => {
    expect(
      resumeInChat(historyRow({ executionHostId: 'runtime:server-1' }), CHAT_OFF_TERMINAL)
    ).toEqual({ available: false, reason: 'remote' })
  })
})

describe('a new Droid launch after a conversation was offered for resume', () => {
  const launchRoute = () =>
    resolveAgentSessionLaunchRoute(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the route builder reads only the settings, host statuses and workspace rows staged here; a missing member reads as absent.
      mocks.state as unknown as AgentLaunchRouteStore,
      { agent: 'droid', workspace: { kind: 'git-worktree', worktreeId: WORKSPACE } }
    )

  it('opens a terminal with the Chat UI switch off', () => {
    resumeInChat(historyRow(), CHAT_OFF_TERMINAL)

    expect(launchRoute()).toBe('terminal-tui')
  })

  it('opens a terminal with the switch on until the host has listed Droid', () => {
    mocks.state.settings = { experimentalNativeChat: true }
    resumeInChat(historyRow(), { experimentalNativeChat: true })

    expect(launchRoute()).toBe('terminal-tui')
  })
})
