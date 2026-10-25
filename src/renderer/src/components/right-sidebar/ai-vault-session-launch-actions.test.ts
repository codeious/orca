// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { WebRuntimeTerminalCreateOutcome } from '@/runtime/web-runtime-session'

const mocks = vi.hoisted(() => ({
  buildAiVaultForkStartupForWorktree: vi.fn(),
  buildAiVaultResumeStartupForWorktree: vi.fn(),
  prepareAiVaultSessionForFork: vi.fn(),
  prepareAiVaultSessionForResume: vi.fn(),
  launchAiVaultSessionInNewTab: vi.fn(),
  activateAiVaultResumeWorkspace: vi.fn(),
  resumeAiVaultSessionInNewChat: vi.fn(),
  confirm: vi.fn<() => Promise<boolean>>(),
  droidSessionHolder: vi.fn<() => Promise<unknown>>(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@/components/confirmation-dialog-context', () => ({
  useConfirmationDialog: () => mocks.confirm
}))

vi.mock('@/lib/ai-vault-session-fork-startup', () => ({
  buildAiVaultForkStartupForWorktree: mocks.buildAiVaultForkStartupForWorktree
}))
vi.mock('@/lib/ai-vault-resume-command', () => ({
  buildAiVaultResumeStartupForWorktree: mocks.buildAiVaultResumeStartupForWorktree,
  buildAiVaultResumeCopyCommandForWorktree: vi.fn()
}))
vi.mock('@/lib/ai-vault-session-resume-preparation', () => ({
  prepareAiVaultSessionForFork: mocks.prepareAiVaultSessionForFork,
  prepareAiVaultSessionForResume: mocks.prepareAiVaultSessionForResume,
  dropDeletedSshResumeCwd: async (session: unknown) => session
}))
vi.mock('@/lib/launch-ai-vault-session', () => ({
  launchAiVaultSessionInNewTab: mocks.launchAiVaultSessionInNewTab
}))
vi.mock('./ai-vault-session-launch-target', () => ({
  resolveAiVaultSessionLaunchTarget: (args: { targetWorktreeId?: string }) => ({
    status: 'ready',
    worktreeId: args.targetWorktreeId
  }),
  resolveAiVaultTargetWorkspacePath: vi.fn(),
  aiVaultResumeUnsupportedMessage: vi.fn()
}))
vi.mock('./ai-vault-session-resume-in-chat-launch', () => ({
  activateAiVaultResumeWorkspace: mocks.activateAiVaultResumeWorkspace,
  resumeAiVaultSessionInNewChat: mocks.resumeAiVaultSessionInNewChat
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ activeWorktreeId: 'worktree-1', settings: {} }) }
}))

import { useAiVaultSessionLaunchActions } from './ai-vault-session-launch-actions'

const owned: AiVaultSession = {
  id: 'local:claude:provider-1:/p.jsonl',
  executionHostId: 'local',
  agent: 'claude',
  sessionId: 'provider-1',
  title: 'Claude Chat',
  cwd: '/repo',
  branch: null,
  model: null,
  filePath: '/p.jsonl',
  codexHome: null,
  createdAt: null,
  updatedAt: null,
  modifiedAt: '2026-10-07T00:00:00.000Z',
  messageCount: 1,
  totalTokens: 0,
  previewMessages: [],
  queuedMessageCount: 0,
  subagentTranscriptCount: 0,
  resumeCommand: 'claude --resume provider-1',
  subagent: null,
  structuredSession: { sessionId: 'chat-1', workspaceId: 'worktree-1' }
}

const FORK_STARTUP = { command: "claude --resume 'provider-1' --fork-session", cwd: '/repo' }

function renderActions() {
  return renderHook(() =>
    useAiVaultSessionLaunchActions({
      activeWorktree: null,
      activeWorktreeId: 'worktree-1',
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked launch target never reads it.
      targetState: {} as never
    })
  ).result.current
}

describe('Resume in New Native Chat launch', () => {
  const droid: AiVaultSession = {
    ...owned,
    id: 'local:droid:droid-1:/d.jsonl',
    agent: 'droid',
    sessionId: 'droid-1',
    filePath: '/d.jsonl',
    structuredSession: undefined
  }
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.confirm.mockResolvedValue(true)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the launch reads one bridge method.
    window.api = { aiVault: { droidSessionHolder: mocks.droidSessionHolder } } as never
  })

  it('resumes a Droid session as Droid once the host proves no terminal holds it', async () => {
    mocks.droidSessionHolder.mockResolvedValue({ holder: null })

    renderActions().handleResumeInNewChat(droid, 'worktree-2')

    await waitFor(() =>
      expect(mocks.resumeAiVaultSessionInNewChat).toHaveBeenCalledWith(
        droid,
        'droid',
        'worktree-2',
        expect.any(String)
      )
    )
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('asks the host that owns the session, at the click', async () => {
    mocks.droidSessionHolder.mockResolvedValue({ holder: null })

    renderActions().handleResumeInNewChat(droid, 'worktree-2')

    await waitFor(() => expect(mocks.resumeAiVaultSessionInNewChat).toHaveBeenCalled())
    expect(mocks.droidSessionHolder).toHaveBeenCalledWith({
      executionHostId: 'local',
      sessionId: 'droid-1'
    })
  })

  it('opens nothing and says so when a live terminal holds the session', async () => {
    mocks.droidSessionHolder.mockResolvedValue({ holder: 'live' })

    renderActions().handleResumeInNewChat(droid, 'worktree-2')

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(mocks.toastError).toHaveBeenCalledWith(
      'A terminal is still running this conversation. Open that terminal instead.'
    )
    expect(mocks.resumeAiVaultSessionInNewChat).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('resumes an unverifiable holder after the person confirms', async () => {
    mocks.droidSessionHolder.mockResolvedValue({ holder: 'unverifiable' })

    renderActions().handleResumeInNewChat(droid, 'worktree-2')

    await waitFor(() => expect(mocks.resumeAiVaultSessionInNewChat).toHaveBeenCalledTimes(1))
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })

  it('opens nothing when the person declines the confirmation', async () => {
    mocks.droidSessionHolder.mockResolvedValue({ holder: 'unverifiable' })
    mocks.confirm.mockResolvedValue(false)

    renderActions().handleResumeInNewChat(droid, 'worktree-2')

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    await settle()
    expect(mocks.resumeAiVaultSessionInNewChat).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('does not ask who holds a Claude session', async () => {
    renderActions().handleResumeInNewChat(owned, 'worktree-2')

    await waitFor(() =>
      expect(mocks.resumeAiVaultSessionInNewChat).toHaveBeenCalledWith(
        owned,
        'claude',
        'worktree-2',
        expect.any(String)
      )
    )
    expect(mocks.droidSessionHolder).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('does nothing for an agent that has no chat to resume into', async () => {
    renderActions().handleResumeInNewChat({ ...droid, agent: 'kimi' }, 'worktree-2')

    await settle()
    expect(mocks.resumeAiVaultSessionInNewChat).not.toHaveBeenCalled()
    expect(mocks.droidSessionHolder).not.toHaveBeenCalled()
  })
})

describe('Resume in New CLI launch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepareAiVaultSessionForFork.mockImplementation(async (session) => session)
    mocks.buildAiVaultForkStartupForWorktree.mockReturnValue(FORK_STARTUP)
    mocks.launchAiVaultSessionInNewTab.mockReturnValue({ tabId: 'tab-1' })
  })

  it('opens the fork plan in the chosen workspace, never the plain resume plan', async () => {
    renderActions().handleResumeInNewCli(owned, 'worktree-2')

    await waitFor(() => expect(mocks.launchAiVaultSessionInNewTab).toHaveBeenCalledTimes(1))
    expect(mocks.prepareAiVaultSessionForFork).toHaveBeenCalledWith(owned)
    expect(mocks.buildAiVaultForkStartupForWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'worktree-2', session: owned })
    )
    expect(mocks.launchAiVaultSessionInNewTab).toHaveBeenCalledWith({
      agent: 'claude',
      worktreeId: 'worktree-2',
      ...FORK_STARTUP
    })
    expect(mocks.activateAiVaultResumeWorkspace).toHaveBeenCalledWith('worktree-2')
    expect(mocks.prepareAiVaultSessionForResume).not.toHaveBeenCalled()
    expect(mocks.buildAiVaultResumeStartupForWorktree).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('shows one toast and opens nothing when the agent cannot fork', async () => {
    mocks.buildAiVaultForkStartupForWorktree.mockReturnValue(null)

    renderActions().handleResumeInNewCli(owned, 'worktree-2')

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(mocks.toastError).toHaveBeenCalledWith('This session cannot be opened in the CLI.')
    expect(mocks.launchAiVaultSessionInNewTab).not.toHaveBeenCalled()
  })

  // A host whose guard predates the fork refuses it as a second writer.
  it('asks for a host update, once, when an older paired host refuses the fork', async () => {
    mocks.launchAiVaultSessionInNewTab.mockReturnValue({
      tabId: null,
      runtimeLaunch: Promise.resolve<WebRuntimeTerminalCreateOutcome>({
        status: 'failed',
        message: 'agent_session_conflict'
      })
    })

    renderActions().handleResumeInNewCli(owned, 'worktree-2')

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Update Orca on the host that runs this chat to resume it in a new CLI.'
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('asks for a host update when an older paired host refuses the fork preparation', async () => {
    mocks.prepareAiVaultSessionForFork.mockRejectedValue(new Error('agent_session_conflict'))

    renderActions().handleResumeInNewCli(owned, 'worktree-2')

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Update Orca on the host that runs this chat to resume it in a new CLI.'
    )
    expect(mocks.launchAiVaultSessionInNewTab).not.toHaveBeenCalled()
  })
})
