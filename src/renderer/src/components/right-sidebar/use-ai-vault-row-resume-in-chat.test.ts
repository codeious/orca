// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultDroidSessionHolder } from '../../../../shared/ai-vault-droid-session-holder'
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

function mountRows(sessions: readonly AiVaultSession[]) {
  return renderHook(() =>
    useAiVaultRowResumeInChat({
      sessions,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubbed resolver reads only the session.
      rowArgs: (session) => ({ session }) as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubbed resolver ignores settings.
      settings: {} as never,
      generation: 1
    })
  )
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
