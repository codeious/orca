import { beforeEach, describe, expect, it, vi } from 'vitest'

const callRuntimeEnvironment = vi.hoisted(() => vi.fn())
vi.mock('../ipc/runtime-environment-transport-routing', () => ({ callRuntimeEnvironment }))

const { readRuntimeAiVaultDroidSessionHolder } = await import('./runtime-droid-session-holder')

beforeEach(() => {
  callRuntimeEnvironment.mockReset()
})

describe('readRuntimeAiVaultDroidSessionHolder', () => {
  it('asks the paired host that owns the pane, by session id only', async () => {
    callRuntimeEnvironment.mockResolvedValue({ id: '1', ok: true, result: { holder: 'live' } })

    await expect(
      readRuntimeAiVaultDroidSessionHolder('/user-data', 'env-1', 'droid-session')
    ).resolves.toEqual({ holder: 'live' })
    expect(callRuntimeEnvironment).toHaveBeenCalledWith(
      '/user-data',
      'env-1',
      'aiVault.droidSessionHolder',
      { sessionId: 'droid-session' }
    )
  })

  it.each(['live', 'unverifiable', null] as const)('relays %s', async (holder) => {
    callRuntimeEnvironment.mockResolvedValue({ id: '1', ok: true, result: { holder } })

    await expect(
      readRuntimeAiVaultDroidSessionHolder('/user-data', 'env-1', 'droid-session')
    ).resolves.toEqual({ holder })
  })

  it('relays the panes the paired host names', async () => {
    const panes = [{ paneKey: 'tab-1:11111111-1111-4111-8111-111111111111', verdict: 'live' }]
    callRuntimeEnvironment.mockResolvedValue({
      id: '1',
      ok: true,
      result: { holder: 'live', panes }
    })

    await expect(
      readRuntimeAiVaultDroidSessionHolder('/user-data', 'env-1', 'droid-session')
    ).resolves.toStrictEqual({ holder: 'live', panes })
  })

  it('reads a paired host that predates panes as holding, with no pane named', async () => {
    callRuntimeEnvironment.mockResolvedValue({ id: '1', ok: true, result: { holder: 'live' } })

    await expect(
      readRuntimeAiVaultDroidSessionHolder('/user-data', 'env-1', 'droid-session')
    ).resolves.toStrictEqual({ holder: 'live' })
  })

  it('cannot tell on a host that predates the method', async () => {
    callRuntimeEnvironment.mockResolvedValue({
      id: '1',
      ok: false,
      error: { code: 'method_not_found', message: 'Unknown method: aiVault.droidSessionHolder' }
    })

    await expect(
      readRuntimeAiVaultDroidSessionHolder('/user-data', 'env-1', 'droid-session')
    ).resolves.toEqual({ holder: 'unverifiable' })
  })

  it('cannot tell when the connection to the host fails', async () => {
    callRuntimeEnvironment.mockRejectedValue(new Error('socket closed'))

    await expect(
      readRuntimeAiVaultDroidSessionHolder('/user-data', 'env-1', 'droid-session')
    ).resolves.toEqual({ holder: 'unverifiable' })
  })

  it('cannot tell when the host answers something that is not a holder', async () => {
    callRuntimeEnvironment.mockResolvedValue({ id: '1', ok: true, result: {} })

    await expect(
      readRuntimeAiVaultDroidSessionHolder('/user-data', 'env-1', 'droid-session')
    ).resolves.toEqual({ holder: 'unverifiable' })
  })
})
