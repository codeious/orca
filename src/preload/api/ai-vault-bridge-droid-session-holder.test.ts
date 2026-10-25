import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_VAULT_DROID_SESSION_HOLDER_CHANNEL } from '../../shared/ai-vault-droid-session-holder'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn() }
}))

const { aiVaultApi } = await import('./ai-vault-bridge')

const ARGS = { executionHostId: 'local', sessionId: 'droid-session' }
const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  invoke.mockReset()
})

describe('aiVaultApi.droidSessionHolder', () => {
  it.each(['live', 'unverifiable', null] as const)(
    'hands the renderer the verdict main answers: %s',
    async (holder) => {
      invoke.mockResolvedValue({ holder })

      await expect(aiVaultApi.droidSessionHolder(ARGS)).resolves.toStrictEqual({ holder })
      expect(invoke).toHaveBeenCalledWith(AI_VAULT_DROID_SESSION_HOLDER_CHANNEL, ARGS)
    }
  )

  it('hands the renderer the panes main names', async () => {
    const panes = [{ paneKey: PANE_KEY, verdict: 'live' }]
    invoke.mockResolvedValue({ holder: 'live', panes })

    await expect(aiVaultApi.droidSessionHolder(ARGS)).resolves.toStrictEqual({
      holder: 'live',
      panes
    })
  })

  it('cannot tell when main fails to answer', async () => {
    invoke.mockRejectedValue(new Error('No handler registered for aiVault:droidSessionHolder'))

    await expect(aiVaultApi.droidSessionHolder(ARGS)).resolves.toStrictEqual({
      holder: 'unverifiable'
    })
  })

  it.each([
    ['nothing', undefined],
    ['an empty object', {}],
    ['a verdict the renderer cannot act on', { holder: 'exited' }],
    ['a bare string', 'live']
  ])('cannot tell when main answers %s, never a free session', async (_label, reply) => {
    invoke.mockResolvedValue(reply)

    await expect(aiVaultApi.droidSessionHolder(ARGS)).resolves.toStrictEqual({
      holder: 'unverifiable'
    })
  })
})
