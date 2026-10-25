// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { AiVaultDroidSessionHolder } from '../../../../shared/ai-vault-droid-session-holder'
import {
  askAiVaultDroidSessionHolder,
  decideAiVaultDroidChatResume
} from './ai-vault-droid-session-holder-check'

const mocks = vi.hoisted(() => ({
  ask: vi.fn<(args: { executionHostId: string; sessionId: string }) => Promise<unknown>>(),
  confirm: vi.fn<(options: { title: string; description?: string }) => Promise<boolean>>()
}))

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields the check reads are staged.
const session = {
  agent: 'droid',
  executionHostId: 'local',
  sessionId: 'droid-session-1'
} as AiVaultSession

function answer(holder: AiVaultDroidSessionHolder): void {
  mocks.ask.mockResolvedValue({ holder })
}

function decide() {
  return decideAiVaultDroidChatResume({ session, confirm: mocks.confirm })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(true)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the check reads one bridge method.
  window.api = { aiVault: { droidSessionHolder: mocks.ask } } as never
})

describe('deciding a Droid chat resume at the click', () => {
  it('asks the host that owns the session, by its own id', async () => {
    answer(null)

    await decide()

    expect(mocks.ask).toHaveBeenCalledWith({
      executionHostId: 'local',
      sessionId: 'droid-session-1'
    })
  })

  it('resumes without asking the person when the host proved nothing holds the session', async () => {
    answer(null)

    expect(await decide()).toBe('resume')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('refuses a session a live terminal holds, without a way to override it', async () => {
    answer('live')

    expect(await decide()).toBe('held')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('resumes an unverifiable holder only after the person confirms the history may split', async () => {
    answer('unverifiable')

    expect(await decide()).toBe('resume')
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })

  it('leaves the session alone when the person declines', async () => {
    answer('unverifiable')
    mocks.confirm.mockResolvedValue(false)

    expect(await decide()).toBe('declined')
  })

  it('reads a failed question as cannot-tell, never as free', async () => {
    mocks.ask.mockRejectedValue(new Error('bridge gone'))

    expect(await decide()).toBe('resume')
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })

  it('reads a bridge that answers nothing as cannot-tell, never as free', async () => {
    mocks.ask.mockResolvedValue(undefined)

    await decide()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })
})

describe('asking the host that owns a Droid session', () => {
  const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

  it('hands back the panes the host names beside the holder', async () => {
    const panes = [{ paneKey: PANE_KEY, verdict: 'live' }]
    mocks.ask.mockResolvedValue({ holder: 'live', panes })

    await expect(askAiVaultDroidSessionHolder(session)).resolves.toStrictEqual({
      holder: 'live',
      panes
    })
  })

  it('names no pane for a bridge that predates panes', async () => {
    mocks.ask.mockResolvedValue({ holder: 'live' })

    await expect(askAiVaultDroidSessionHolder(session)).resolves.toStrictEqual({ holder: 'live' })
  })

  it.each([
    ['a bare null, which only the answer object may carry', null],
    ['a bare live', 'live'],
    ['a synonym for free', { holder: 'free' }]
  ])('reads %s as cannot-tell, never as free', async (_label, reply) => {
    mocks.ask.mockResolvedValue(reply)

    await expect(askAiVaultDroidSessionHolder(session)).resolves.toStrictEqual({
      holder: 'unverifiable'
    })
  })
})
