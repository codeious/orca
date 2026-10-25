import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STRUCTURED_AGENT_SESSION_RESUME_HISTORY_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'

const mocks = vi.hoisted(() => ({
  owner: vi.fn<() => string | null>(() => 'local'),
  localCapabilities: vi.fn<() => readonly string[] | null>(() => []),
  feasible: vi.fn<(store: unknown, request: { agent: string }) => boolean>(() => true),
  state: { runtimeStatusByEnvironmentId: new Map<string, unknown>() }
}))

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/runtime/structured-agent-session-owner', () => ({
  resolveStructuredAgentSessionOwner: mocks.owner
}))
vi.mock('@/runtime/local-runtime-capabilities', () => ({
  readLocalRuntimeCapabilitiesOrUnknown: mocks.localCapabilities
}))
// The route's own feasibility is pinned elsewhere; this suite pins the host rule on top of it.
vi.mock('@/lib/agent-session-launch-plan', () => ({
  structuredAgentSessionLaunchFeasible: mocks.feasible
}))

import {
  resolveAiVaultHistoryRowResume,
  resolveAiVaultSessionResumeInChatForWorkspace
} from './ai-vault-session-resume-in-chat-workspace'

const PAIRED_WORKSPACE = 'repo-1::/srv/orca'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields eligibility reads are staged.
const codexSession = {
  id: 'codex-1',
  agent: 'codex',
  executionHostId: 'local',
  cwd: '/Users/me/orca',
  filePath: '/Users/me/.codex/sessions/rollout-1.jsonl',
  messageCount: 4,
  previewMessages: []
} as unknown as AiVaultSession

function resumeInChat() {
  return resolveAiVaultSessionResumeInChatForWorkspace({
    session: codexSession,
    resumeState: { blocked: true, worktreeId: null, usesSessionWorktree: false },
    activeWorkspaceId: PAIRED_WORKSPACE,
    targetState: { folderWorkspaces: [], projectGroups: [], repos: [], worktreesByRepo: {} },
    settings: {
      experimentalNativeChat: true
    }
  })
}

const DROID_WORKSPACE_PATH = '/srv/orca'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields eligibility reads are staged.
const droidSession = {
  id: 'droid-1',
  agent: 'droid',
  executionHostId: 'local',
  cwd: DROID_WORKSPACE_PATH,
  filePath: '/Users/me/.factory/sessions/-srv-orca/droid-1.jsonl',
  messageCount: 4,
  previewMessages: []
} as unknown as AiVaultSession

function droidResumeInChat(
  args: { session?: AiVaultSession; droidHolder?: 'live' | 'unverifiable' | null } = {}
) {
  return resolveAiVaultSessionResumeInChatForWorkspace({
    session: args.session ?? droidSession,
    resumeState: { blocked: true, worktreeId: null, usesSessionWorktree: false },
    activeWorkspaceId: PAIRED_WORKSPACE,
    targetState: {
      folderWorkspaces: [],
      projectGroups: [],
      repos: [],
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the path lookup reads id and path only.
      worktreesByRepo: {
        'repo-1': [{ id: PAIRED_WORKSPACE, path: DROID_WORKSPACE_PATH }]
      } as never
    },
    settings: { experimentalNativeChat: true },
    ...('droidHolder' in args ? { droidHolder: args.droidHolder } : {})
  })
}

beforeEach(() => {
  mocks.feasible.mockClear()
  mocks.localCapabilities.mockReturnValue([
    STRUCTURED_AGENT_SESSION_RESUME_HISTORY_RUNTIME_CAPABILITY
  ])
  mocks.state.runtimeStatusByEnvironmentId = new Map([
    [
      'server-1',
      { status: { capabilities: [STRUCTURED_AGENT_SESSION_RESUME_HISTORY_RUNTIME_CAPABILITY] } }
    ]
  ])
})

describe('resuming a conversation from history in a chat', () => {
  // The conversation's transcript is on this machine, which the server cannot read; the
  // terminal resume refuses that target for the same reason.
  it("is not offered in a paired server's workspace for a conversation recorded here", () => {
    mocks.owner.mockReturnValue('runtime:server-1')

    expect(resumeInChat()).toEqual({ available: false, reason: 'workspace' })
  })

  it('is offered in a workspace on the machine that recorded it', () => {
    mocks.owner.mockReturnValue('local')

    expect(resumeInChat()).toEqual({ available: true, workspaceId: PAIRED_WORKSPACE })
  })

  it('asks the host that would run it whether it can resume, not another', () => {
    mocks.owner.mockReturnValue('local')
    mocks.localCapabilities.mockReturnValue([])

    expect(resumeInChat()).toEqual({ available: false, reason: 'workspace' })
  })
})

describe('resuming a Droid conversation from history in a chat', () => {
  beforeEach(() => mocks.owner.mockReturnValue('local'))

  it('asks whether a Droid chat can open here, as Droid', () => {
    droidResumeInChat({ droidHolder: null })

    expect(mocks.feasible).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agent: 'droid' })
    )
  })

  it('is offered, with the confirmation, before anyone has said who holds it', () => {
    expect(droidResumeInChat()).toEqual({
      available: true,
      workspaceId: PAIRED_WORKSPACE,
      confirmHeldSession: true
    })
  })

  it('is offered plainly once the host has proved no terminal holds it', () => {
    expect(droidResumeInChat({ droidHolder: null })).toEqual({
      available: true,
      workspaceId: PAIRED_WORKSPACE
    })
  })

  it('is not offered while a live terminal holds it', () => {
    expect(droidResumeInChat({ droidHolder: 'live' })).toEqual({
      available: false,
      reason: 'held'
    })
  })

  it('is not offered in a folder other than the one it was recorded in', () => {
    const elsewhere = { ...droidSession, cwd: '/srv/other' }

    expect(droidResumeInChat({ session: elsewhere, droidHolder: null })).toEqual({
      available: false,
      reason: 'workspace'
    })
  })

  // The recorded folder is the history's own `session_start.cwd`, so a folder that was deleted
  // since matches no workspace, and a history that never recorded one matches nothing at all.
  it.each([null, ''])('is not offered when its history recorded no folder (%j)', (cwd) => {
    const unrecorded = { ...droidSession, cwd }

    expect(droidResumeInChat({ session: unrecorded, droidHolder: null })).toEqual({
      available: false,
      reason: 'workspace'
    })
  })

  it("is not offered in a paired server's workspace for a conversation recorded here", () => {
    mocks.owner.mockReturnValue('runtime:server-1')

    expect(droidResumeInChat({ droidHolder: null })).toEqual({
      available: false,
      reason: 'workspace'
    })
  })

  // Every history surface reads a row through this composition; only the panel lists Droid rows.
  it('carries the holder through the composed row answer both surfaces read', () => {
    const rowResume = (droidHolder?: 'live' | null) =>
      resolveAiVaultHistoryRowResume({
        session: droidSession,
        worktreeInfo: null,
        activeWorktreeId: PAIRED_WORKSPACE,
        worktrees: [],
        repos: [],
        targetState: {
          folderWorkspaces: [],
          projectGroups: [],
          repos: [],
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the path lookup reads id and path only.
          worktreesByRepo: {
            'repo-1': [{ id: PAIRED_WORKSPACE, path: DROID_WORKSPACE_PATH }]
          } as never
        },
        settings: { experimentalNativeChat: true },
        droidHolder
      }).resumeInChat

    expect(rowResume('live')).toEqual({ available: false, reason: 'held' })
    expect(rowResume(null)).toEqual({ available: true, workspaceId: PAIRED_WORKSPACE })
    expect(rowResume()).toMatchObject({ available: true, confirmHeldSession: true })
  })
})
