// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as WorktreeActivation from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { useAiVaultOriginalPaneActions } from './ai-vault-original-pane-actions'

const mocks = vi.hoisted(() => ({
  reveal: vi.fn<(worktreeId: string) => unknown>(),
  focus: vi.fn<(tabId: string, leafId: string | null, opts?: unknown) => void>(),
  toastError: vi.fn<(message: string) => void>()
}))

vi.mock('@/lib/worktree-activation', async (importOriginal) => ({
  ...(await importOriginal<typeof WorktreeActivation>()),
  activateAndRevealWorktree: mocks.reveal
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({ activateTabAndFocusPane: mocks.focus }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

const LEAF = '11111111-1111-4111-8111-111111111111'
const PANE = makePaneKey('tab-1', LEAF)
const TARGET = { paneKey: PANE, worktreeId: 'wt-1', tabId: 'tab-1', leafId: LEAF }

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields the pane lookup reads are staged.
const session = {
  id: 'local:droid:conversation-1',
  agent: 'droid',
  executionHostId: 'local',
  sessionId: 'conversation-1'
} as AiVaultSession

function openTerminal(): void {
  useAppStore.setState({
    tabsByWorktree: {
      'wt-1': [
        {
          id: 'tab-1',
          ptyId: null,
          worktreeId: 'wt-1',
          title: 'Droid',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    },
    terminalLayoutsByTabId: {
      'tab-1': {
        root: { type: 'leaf', leafId: LEAF },
        activeLeafId: LEAF,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF]: 'pty-1' }
      }
    }
  })
}

function jump(target?: typeof TARGET): void {
  const { result } = renderHook(() => useAiVaultOriginalPaneActions())
  result.current.jumpToOriginalPane(session, target)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.reveal.mockReturnValue({ primaryTabId: null })
  useAppStore.setState({
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
    agentStatusByPaneKey: {}
  })
})

describe('jumping to the terminal that holds a session', () => {
  it('focuses the terminal the host named although no pane carries the session identity', () => {
    openTerminal()

    jump(TARGET)

    expect(mocks.reveal).toHaveBeenCalledWith('wt-1')
    expect(mocks.focus).toHaveBeenCalledWith('tab-1', LEAF, expect.anything())
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('says so, and focuses nothing, when that terminal closed before the click', () => {
    jump(TARGET)

    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(mocks.focus).not.toHaveBeenCalled()
  })

  it('still finds the pane by session identity when it is given no terminal', () => {
    openTerminal()
    const entry: AgentStatusEntry = {
      state: 'working',
      prompt: 'continue',
      updatedAt: 1,
      stateStartedAt: 1,
      agentType: 'droid',
      paneKey: PANE,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      stateHistory: [],
      providerSession: { key: 'session_id', id: 'conversation-1' }
    }
    useAppStore.setState({ agentStatusByPaneKey: { [PANE]: entry } })

    jump()

    expect(mocks.focus).toHaveBeenCalledWith('tab-1', LEAF, expect.anything())
  })

  it('says so when no pane carries the session identity and it is given no terminal', () => {
    openTerminal()

    jump()

    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(mocks.focus).not.toHaveBeenCalled()
  })
})
