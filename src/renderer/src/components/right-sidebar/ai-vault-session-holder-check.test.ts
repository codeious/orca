import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { makePaneKey } from '../../../../shared/stable-pane-id'

const mocks = vi.hoisted(() => ({
  supports: vi.fn<() => Promise<boolean>>(),
  rpc: vi.fn<() => Promise<unknown>>(),
  error: vi.fn(),
  reveal: vi.fn()
}))
const leaf = '11111111-1111-4111-8111-111111111111'
vi.mock('@/runtime/structured-agent-session-client', () => ({
  structuredAgentSessionHostSupports: mocks.supports
}))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.rpc }))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))
vi.mock('@/lib/reveal-terminal-pane', () => ({ revealTerminalPane: mocks.reveal }))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      tabsByWorktree: { folder: [{ id: 'terminal-tab' }] },
      terminalLayoutsByTabId: {
        'terminal-tab': {
          root: { type: 'leaf', leafId: leaf },
          ptyIdsByLeafId: { [leaf]: 'remote:host@@terminal' }
        }
      }
    })
  }
}))

import { allowAiVaultChatResume } from './ai-vault-session-holder-check'
const target = { kind: 'environment', environmentId: 'host' } as const
const session = { agent: 'droid', sessionId: 'provider-session' } as const

beforeEach(() => {
  vi.resetAllMocks()
  mocks.supports.mockResolvedValue(true)
})

describe('Droid resume holder confirmation', () => {
  it('blocks a live writer and reveals its terminal on the recording host', async () => {
    mocks.rpc.mockResolvedValue({
      holder: 'live',
      panes: [{ paneKey: makePaneKey('terminal-tab', leaf), verdict: 'live' }]
    })
    const confirm = vi.fn<ConfirmationDialogContextValue>()
    expect(await allowAiVaultChatResume(target, session, confirm)).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    const options = mocks.error.mock.calls[0]?.[1]
    options?.action.onClick()
    expect(mocks.reveal).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'folder',
        tabId: 'terminal-tab',
        leafId: leaf,
        executionHostId: 'runtime:host'
      })
    )
  })

  it.each([true, false])(
    'resumes an unverifiable writer only with confirmation: %s',
    async (accepted) => {
      mocks.rpc.mockResolvedValue({ holder: 'unverifiable' })
      const confirm = vi.fn<ConfirmationDialogContextValue>().mockResolvedValue(accepted)
      expect(await allowAiVaultChatResume(target, session, confirm)).toBe(accepted)
      expect(confirm).toHaveBeenCalledOnce()
      expect(mocks.rpc).toHaveBeenCalledWith(target, 'aiVault.sessionHolder', {
        agent: 'droid',
        sessionId: session.sessionId
      })
    }
  )

  it.each(['old-host', 'offline', 'malformed'] as const)(
    'never treats %s as an exit',
    async (kind) => {
      mocks.supports.mockResolvedValue(kind !== 'old-host')
      if (kind === 'offline') {
        mocks.rpc.mockRejectedValue(new Error('disconnected'))
      } else {
        mocks.rpc.mockResolvedValue({})
      }
      expect(await allowAiVaultChatResume(target, session)).toBe(false)
      if (kind === 'old-host') {
        expect(mocks.rpc).not.toHaveBeenCalled()
      }
    }
  )

  it('admits proven no holders and leaves agents without the policy unchanged', async () => {
    mocks.rpc.mockResolvedValue({ holder: null })
    const confirm = vi.fn<ConfirmationDialogContextValue>()
    expect(await allowAiVaultChatResume(target, session, confirm)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    mocks.rpc.mockClear()
    expect(await allowAiVaultChatResume(target, { ...session, agent: 'codex' })).toBe(true)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
