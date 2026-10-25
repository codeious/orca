// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AiVaultDroidSessionHolder } from '../../../../shared/ai-vault-droid-session-holder'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { AiVaultResumeInChatEligibility } from './ai-vault-session-resume-in-chat'
import { useAiVaultRowResumeInChat } from './use-ai-vault-row-resume-in-chat'

const mocks = vi.hoisted(() => ({
  ask: vi.fn<(args: { executionHostId: string; sessionId: string }) => Promise<unknown>>()
}))

// Stands in for the shared row resolver: a blocked row is never offered, and a row nobody has
// answered for reads as needing a confirmation, as the real eligibility does.
function stubResumeInChat(
  session: AiVaultSession,
  droidHolder?: AiVaultDroidSessionHolder
): AiVaultResumeInChatEligibility {
  if (session.sessionId.startsWith('elsewhere')) {
    return { available: false, reason: 'workspace' }
  }
  if (session.agent !== 'droid') {
    return { available: true, workspaceId: 'ws-1' }
  }
  if (droidHolder === 'live') {
    return { available: false, reason: 'held' }
  }
  return droidHolder === null
    ? { available: true, workspaceId: 'ws-1' }
    : { available: true, workspaceId: 'ws-1', confirmHeldSession: true }
}

vi.mock('./ai-vault-session-resume-in-chat-workspace', () => ({
  resolveAiVaultHistoryRowResume: (args: {
    session: AiVaultSession
    droidHolder?: AiVaultDroidSessionHolder
  }) => ({ resumeInChat: stubResumeInChat(args.session, args.droidHolder) })
}))

function row(agent: AiVaultSession['agent'], sessionId: string): AiVaultSession {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields the row question reads are staged.
  return {
    id: `local:${agent}:${sessionId}`,
    agent,
    executionHostId: 'local',
    sessionId
  } as AiVaultSession
}

// Held across renders, as the panel holds them: a fresh function or object each render would
// rebuild the answer every time and hide a missing dependency in the hook.
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubbed resolver reads only the session.
const rowArgs = (session: AiVaultSession) => ({ session }) as never
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubbed resolver ignores settings.
const settings = {} as never

function mountRows(sessions: readonly AiVaultSession[]) {
  return renderHook(() => useAiVaultRowResumeInChat({ sessions, rowArgs, settings, generation: 1 }))
}

beforeEach(() => {
  vi.clearAllMocks()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook reads one bridge method.
  window.api = { aiVault: { droidSessionHolder: mocks.ask } } as never
})

describe('the resume-in-chat answer for a history row', () => {
  it('reads a Droid row nobody has answered for as needing a confirmation, not as free', () => {
    mocks.ask.mockReturnValue(new Promise(() => {}))
    const sessions = [row('droid', 'a')]

    const { result } = mountRows(sessions)

    expect(result.current(sessions[0])).toEqual({
      available: true,
      workspaceId: 'ws-1',
      confirmHeldSession: true
    })
  })

  it('stops offering a Droid row once its host says a terminal holds it', async () => {
    mocks.ask.mockResolvedValue({ holder: 'live' })
    const sessions = [row('droid', 'a')]

    const { result } = mountRows(sessions)

    await waitFor(() =>
      expect(result.current(sessions[0])).toEqual({ available: false, reason: 'held' })
    )
  })

  it('offers a Droid row without a confirmation once its host proves it is free', async () => {
    mocks.ask.mockResolvedValue({ holder: null })
    const sessions = [row('droid', 'a')]

    const { result } = mountRows(sessions)

    await waitFor(() =>
      expect(result.current(sessions[0])).toEqual({ available: true, workspaceId: 'ws-1' })
    )
  })

  it('keeps a Droid row needing a confirmation when its host cannot answer', async () => {
    mocks.ask.mockRejectedValue(new Error('bridge gone'))
    const sessions = [row('droid', 'a')]

    const { result } = mountRows(sessions)

    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1))
    expect(result.current(sessions[0])).toMatchObject({ available: true, confirmHeldSession: true })
  })

  it('asks only about Droid rows, so a Claude or Codex row costs no host call', async () => {
    mocks.ask.mockResolvedValue({ holder: null })

    mountRows([row('claude', 'c'), row('codex', 'x'), row('droid', 'a')])

    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1))
    expect(mocks.ask).toHaveBeenCalledWith({ executionHostId: 'local', sessionId: 'a' })
  })

  it('does not ask about a Droid row the workspace already rules out', async () => {
    mocks.ask.mockResolvedValue({ holder: null })

    mountRows([row('droid', 'elsewhere-1'), row('droid', 'a')])

    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1))
    expect(mocks.ask).toHaveBeenCalledWith({ executionHostId: 'local', sessionId: 'a' })
  })

  it('leaves every other agent exactly as the resolver answers', () => {
    const sessions = [row('claude', 'c')]

    const { result } = mountRows(sessions)

    expect(result.current(sessions[0])).toEqual({ available: true, workspaceId: 'ws-1' })
  })
})

describe('the terminal a held Droid row can be opened in', () => {
  const LEAF = '11111111-1111-4111-8111-111111111111'
  const PANE = makePaneKey('tab-1', LEAF)
  const HELD = { available: false, reason: 'held' }

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

  // A confirm-first row reads the same before and after its answer lands, so an unchanged
  // result proves nothing until the host's reply has been applied.
  async function settleHostAnswers(): Promise<void> {
    await waitFor(() => expect(mocks.ask).toHaveBeenCalled())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  beforeEach(() => {
    useAppStore.setState({ tabsByWorktree: {}, terminalLayoutsByTabId: {} })
  })

  it('is carried by the row once its host names a live pane that is open here', async () => {
    openTerminal()
    mocks.ask.mockResolvedValue({ holder: 'live', panes: [{ paneKey: PANE, verdict: 'live' }] })
    const sessions = [row('droid', 'a')]

    const { result } = mountRows(sessions)

    await waitFor(() =>
      expect(result.current(sessions[0])).toEqual({
        ...HELD,
        openTerminal: { paneKey: PANE, worktreeId: 'wt-1', tabId: 'tab-1', leafId: LEAF }
      })
    )
  })

  it('is left off when the named pane is not open here, so the row stays not offered', async () => {
    mocks.ask.mockResolvedValue({ holder: 'live', panes: [{ paneKey: PANE, verdict: 'live' }] })
    const sessions = [row('droid', 'a')]

    const { result } = mountRows(sessions)

    await waitFor(() => expect(result.current(sessions[0])).toEqual(HELD))
  })

  it('is left off when the host names no pane, as an older host does', async () => {
    openTerminal()
    mocks.ask.mockResolvedValue({ holder: 'live' })
    const sessions = [row('droid', 'a')]

    const { result } = mountRows(sessions)

    await waitFor(() => expect(result.current(sessions[0])).toEqual(HELD))
  })

  it('does not change the confirmation for a pane that only might hold the session', async () => {
    openTerminal()
    mocks.ask.mockResolvedValue({
      holder: 'unverifiable',
      panes: [{ paneKey: PANE, verdict: 'unverifiable' }]
    })
    const sessions = [row('droid', 'a')]

    const { result } = mountRows(sessions)

    await settleHostAnswers()
    expect(result.current(sessions[0])).toEqual({
      available: true,
      workspaceId: 'ws-1',
      confirmHeldSession: true
    })
  })

  it('is never attached to a row that is still offered, whatever panes the host lists', async () => {
    openTerminal()
    mocks.ask.mockResolvedValue({
      holder: 'unverifiable',
      panes: [{ paneKey: PANE, verdict: 'live' }]
    })
    const sessions = [row('droid', 'a')]

    const { result } = mountRows(sessions)

    await settleHostAnswers()
    expect(result.current(sessions[0])).toEqual({
      available: true,
      workspaceId: 'ws-1',
      confirmHeldSession: true
    })
  })

  it('appears once the named pane opens after the answer arrived', async () => {
    mocks.ask.mockResolvedValue({ holder: 'live', panes: [{ paneKey: PANE, verdict: 'live' }] })
    const sessions = [row('droid', 'a')]
    const { result } = mountRows(sessions)
    await waitFor(() => expect(result.current(sessions[0])).toEqual(HELD))

    act(() => openTerminal())

    await waitFor(() => expect(result.current(sessions[0])).toHaveProperty('openTerminal'))
  })
})
