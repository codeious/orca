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
    ).resolves.toBe('live')
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
    ).resolves.toBe(holder)
  })

  it('cannot tell on a host that predates the method', async () => {
    callRuntimeEnvironment.mockResolvedValue({
      id: '1',
      ok: false,
      error: { code: 'method_not_found', message: 'Unknown method: aiVault.droidSessionHolder' }
    })

    await expect(
      readRuntimeAiVaultDroidSessionHolder('/user-data', 'env-1', 'droid-session')
    ).resolves.toBe('unverifiable')
  })

  it('cannot tell when the connection to the host fails', async () => {
    callRuntimeEnvironment.mockRejectedValue(new Error('socket closed'))

    await expect(
      readRuntimeAiVaultDroidSessionHolder('/user-data', 'env-1', 'droid-session')
    ).resolves.toBe('unverifiable')
  })

  it('cannot tell when the host answers something that is not a holder', async () => {
    callRuntimeEnvironment.mockResolvedValue({ id: '1', ok: true, result: {} })

    await expect(
      readRuntimeAiVaultDroidSessionHolder('/user-data', 'env-1', 'droid-session')
    ).resolves.toBe('unverifiable')
  })
})
