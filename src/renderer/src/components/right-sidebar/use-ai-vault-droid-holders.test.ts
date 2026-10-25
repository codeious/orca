// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { useAiVaultDroidHolders } from './use-ai-vault-droid-holders'

const mocks = vi.hoisted(() => ({
  ask: vi.fn<(args: { executionHostId: string; sessionId: string }) => Promise<unknown>>()
}))

function droid(sessionId: string): AiVaultSession {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields the holder question reads are staged.
  return {
    id: `local:droid:${sessionId}`,
    agent: 'droid',
    executionHostId: 'local',
    sessionId
  } as AiVaultSession
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook reads one bridge method.
  window.api = { aiVault: { droidSessionHolder: mocks.ask } } as never
})

describe('the Droid holder verdicts a history list shows', () => {
  it('has no verdict for a row until its host has answered', async () => {
    const pending = deferred<unknown>()
    mocks.ask.mockReturnValue(pending.promise)
    const sessions = [droid('a')]

    const { result } = renderHook(() => useAiVaultDroidHolders({ sessions, generation: 1 }))

    expect(result.current.has('local:droid:a')).toBe(false)
    await act(async () => pending.resolve({ holder: 'live' }))
    expect(result.current.get('local:droid:a')).toStrictEqual({ holder: 'live' })
  })

  it("keeps the host's proof that nobody holds a row as null, not as missing", async () => {
    mocks.ask.mockResolvedValue({ holder: null })
    const sessions = [droid('a')]

    const { result } = renderHook(() => useAiVaultDroidHolders({ sessions, generation: 1 }))

    await waitFor(() => expect(result.current.has('local:droid:a')).toBe(true))
    expect(result.current.get('local:droid:a')).toStrictEqual({ holder: null })
  })

  it('keeps the panes the host names for a row', async () => {
    const panes = [{ paneKey: 'tab-1:11111111-1111-4111-8111-111111111111', verdict: 'live' }]
    mocks.ask.mockResolvedValue({ holder: 'live', panes })
    const sessions = [droid('a')]

    const { result } = renderHook(() => useAiVaultDroidHolders({ sessions, generation: 1 }))

    await waitFor(() =>
      expect(result.current.get('local:droid:a')).toStrictEqual({ holder: 'live', panes })
    )
  })

  it('records a failed question as cannot-tell, never as free', async () => {
    mocks.ask.mockRejectedValue(new Error('bridge gone'))
    const sessions = [droid('a')]

    const { result } = renderHook(() => useAiVaultDroidHolders({ sessions, generation: 1 }))

    await waitFor(() =>
      expect(result.current.get('local:droid:a')).toStrictEqual({ holder: 'unverifiable' })
    )
  })

  it('asks each row about its own session', async () => {
    mocks.ask.mockResolvedValue({ holder: null })
    const sessions = [droid('a'), droid('b')]

    renderHook(() => useAiVaultDroidHolders({ sessions, generation: 1 }))

    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(2))
    expect(mocks.ask).toHaveBeenCalledWith({ executionHostId: 'local', sessionId: 'a' })
    expect(mocks.ask).toHaveBeenCalledWith({ executionHostId: 'local', sessionId: 'b' })
  })

  it('does not ask again when the same rows arrive in a new array', async () => {
    mocks.ask.mockResolvedValue({ holder: null })

    const { rerender } = renderHook(
      ({ sessions }) => useAiVaultDroidHolders({ sessions, generation: 1 }),
      { initialProps: { sessions: [droid('a')] } }
    )
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1))
    rerender({ sessions: [droid('a')] })
    await act(async () => {})

    expect(mocks.ask).toHaveBeenCalledTimes(1)
  })

  it('asks again after a fresh scan, because a terminal may have started or ended', async () => {
    mocks.ask.mockResolvedValue({ holder: null })
    const sessions = [droid('a')]

    const { rerender } = renderHook(
      ({ generation }) => useAiVaultDroidHolders({ sessions, generation }),
      { initialProps: { generation: 1 } }
    )
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1))
    mocks.ask.mockResolvedValue({ holder: 'live' })
    rerender({ generation: 2 })

    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(2))
  })

  it('asks about each row once per scan while the list is filtered, reordered or grown', async () => {
    mocks.ask.mockResolvedValue({ holder: null })
    const rows = Array.from({ length: 50 }, (_, index) => droid(`s${index}`))

    const { rerender } = renderHook(
      ({ sessions }) => useAiVaultDroidHolders({ sessions, generation: 1 }),
      { initialProps: { sessions: rows.slice(0, 40) } }
    )
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(40))
    rerender({ sessions: rows.slice(0, 20) })
    rerender({ sessions: rows.slice(0, 20).toReversed() })
    rerender({ sessions: rows })
    await act(async () => {})

    expect(mocks.ask).toHaveBeenCalledTimes(50)
  })

  it('keeps an answer still in flight when the list changes under it', async () => {
    const pending = deferred<unknown>()
    mocks.ask.mockReturnValueOnce(pending.promise).mockResolvedValue({ holder: null })

    const { result, rerender } = renderHook(
      ({ sessions }) => useAiVaultDroidHolders({ sessions, generation: 1 }),
      { initialProps: { sessions: [droid('a')] } }
    )
    rerender({ sessions: [droid('a'), droid('b')] })
    await act(async () => pending.resolve({ holder: 'live' }))

    expect(result.current.get('local:droid:a')).toStrictEqual({ holder: 'live' })
    expect(mocks.ask).toHaveBeenCalledTimes(2)
  })

  it('asks about a row that appears later', async () => {
    mocks.ask.mockResolvedValue({ holder: null })

    const { rerender } = renderHook(
      ({ sessions }) => useAiVaultDroidHolders({ sessions, generation: 1 }),
      { initialProps: { sessions: [droid('a')] } }
    )
    await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1))
    rerender({ sessions: [droid('a'), droid('b')] })

    await waitFor(() =>
      expect(mocks.ask).toHaveBeenCalledWith({
        executionHostId: 'local',
        sessionId: 'b'
      })
    )
  })

  it('drops an answer that a newer scan has already replaced', async () => {
    const stale = deferred<unknown>()
    mocks.ask.mockReturnValueOnce(stale.promise).mockResolvedValue({ holder: 'live' })
    const sessions = [droid('a')]

    const { result, rerender } = renderHook(
      ({ generation }) => useAiVaultDroidHolders({ sessions, generation }),
      { initialProps: { generation: 1 } }
    )
    rerender({ generation: 2 })
    await waitFor(() =>
      expect(result.current.get('local:droid:a')).toStrictEqual({ holder: 'live' })
    )
    await act(async () => stale.resolve({ holder: null }))

    expect(result.current.get('local:droid:a')).toStrictEqual({ holder: 'live' })
  })
})
