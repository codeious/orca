// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { AiVaultResumeInChatEligibility } from './ai-vault-session-resume-in-chat'

const mocks = vi.hoisted(() => ({
  ask: vi.fn<(args: { executionHostId: string; sessionId: string }) => Promise<unknown>>()
}))
// What the panel last handed the list to answer "can this row resume into a chat".
let rowResume: ((session: AiVaultSession) => AiVaultResumeInChatEligibility) | undefined

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (select: (state: Record<string, unknown>) => unknown) =>
      select({
        settings: {},
        runtimeEnvironments: [],
        folderWorkspaces: {},
        projectGroups: [],
        repos: [],
        worktreesByRepo: {}
      }),
    { getState: () => ({}) }
  )
}))
vi.mock('@/store/selectors', () => ({
  useActiveRepo: () => null,
  useActiveWorktree: () => null,
  useActiveWorktreeId: () => null,
  useAllWorktrees: () => [],
  useProjectHostSetupProjection: () => ({ projects: [], setups: [] }),
  useRepos: () => []
}))

// A stable scan, as the real refresh hook holds one in state between scans.
const droidRow = vaultSession('droid-1')
const scan = { sessions: [droidRow], issues: [], scannedAt: '2026-05-01T10:10:00.000Z' }
vi.mock('./ai-vault-session-refresh', () => ({
  useAiVaultSessionRefresh: () => ({
    error: null,
    loading: false,
    refresh: vi.fn(),
    scanResult: scan,
    sessions: scan.sessions
  })
}))
vi.mock('./ai-vault-session-launch-actions', () => ({
  useAiVaultSessionLaunchActions: () => ({
    buildResumeStartup: vi.fn(),
    copyResumeCommand: vi.fn(),
    handleResume: vi.fn(),
    handleResumeInNewChat: vi.fn(),
    handleContinueInNewSession: vi.fn(),
    continuationRequest: null,
    handleContinuationDialogOpenChange: vi.fn()
  })
}))
vi.mock('./ai-vault-original-pane-actions', () => ({
  useAiVaultOriginalPaneActions: () => ({
    getOriginalPaneTarget: vi.fn(),
    getSessionLiveState: vi.fn(),
    jumpToOriginalPane: vi.fn(),
    jumpToWorktree: vi.fn()
  })
}))
vi.mock('./ai-vault-session-delete-action', () => ({
  useAiVaultSessionDeleteAction: () => vi.fn()
}))
// The empty store cannot make a row eligible, so the workspace question is answered here and only
// the holder is left to the panel.
vi.mock('./ai-vault-session-resume-in-chat-workspace', () => ({
  resolveAiVaultHistoryRowResume: (args: { droidHolder?: 'live' | 'unverifiable' | null }) => ({
    resumeInChat:
      args.droidHolder === 'live'
        ? { available: false, reason: 'held' }
        : { available: true, workspaceId: 'ws-1' }
  })
}))
vi.mock('./AiVaultSessionVirtualList', () => ({
  AiVaultSessionVirtualList: (props: {
    getSessionResumeInChat: (session: AiVaultSession) => AiVaultResumeInChatEligibility
  }) => {
    rowResume = props.getSessionResumeInChat
    return null
  }
}))

function vaultSession(sessionId: string): AiVaultSession {
  return {
    id: `local:droid:${sessionId}`,
    executionHostId: 'local',
    agent: 'droid',
    sessionId,
    title: 'Port the importer',
    cwd: '/Users/ada/repo',
    branch: null,
    model: null,
    filePath: `/Users/ada/.factory/sessions/${sessionId}.jsonl`,
    codexHome: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:10:00.000Z',
    modifiedAt: '2026-05-01T10:10:00.000Z',
    messageCount: 4,
    totalTokens: 10,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: 'droid --resume',
    subagent: null
  }
}

beforeEach(() => {
  rowResume = undefined
  mocks.ask.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      aiVault: { droidSessionHolder: mocks.ask, searchSessions: vi.fn() },
      ui: { writeClipboardText: vi.fn() }
    }
  })
})
afterEach(cleanup)

async function mountPanel() {
  // Imported here so the hoisted mock factories are in place first.
  const { default: AiVaultPanel } = await import('./AiVaultPanel')
  render(<AiVaultPanel />)
}

it('stops offering a Droid history row once its host says a terminal holds it', async () => {
  mocks.ask.mockResolvedValue('live')

  await mountPanel()

  await waitFor(() => expect(rowResume?.(droidRow)).toEqual({ available: false, reason: 'held' }))
  expect(mocks.ask).toHaveBeenCalledWith({ executionHostId: 'local', sessionId: 'droid-1' })
})

it('offers a Droid history row while its host has not yet answered', async () => {
  mocks.ask.mockReturnValue(new Promise(() => {}))

  await mountPanel()

  await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1))
  expect(rowResume?.(droidRow)).toEqual({ available: true, workspaceId: 'ws-1' })
})
