import { beforeEach, describe, expect, it, vi } from 'vitest'

const callRuntimeResult = vi.hoisted(() => vi.fn())
vi.mock('./web-runtime-calls', () => ({ callRuntimeResult }))
vi.mock('./web-runtime-session', () => ({
  requireActiveEnvironment: () => ({ id: 'owning-host' })
}))
import { createWebAiVaultApi } from './web-ai-vault-api'

const OWN = { executionHostId: 'runtime:owning-host', sessionId: 'droid-session' }

beforeEach(() => {
  callRuntimeResult.mockReset()
})

describe('web aiVault.droidSessionHolder', () => {
  it.each(['live', 'unverifiable', null] as const)(
    'asks the paired runtime that owns the pane and relays %s',
    async (holder) => {
      callRuntimeResult.mockResolvedValue({ holder })

      await expect(createWebAiVaultApi().droidSessionHolder(OWN)).resolves.toBe(holder)
      expect(callRuntimeResult).toHaveBeenCalledExactlyOnceWith('aiVault.droidSessionHolder', {
        sessionId: 'droid-session'
      })
    }
  )

  it.each([
    ['a different paired runtime', 'runtime:other-host'],
    ['a local session, which a browser has no machine for', 'local'],
    ['an SSH session', 'ssh:build-box'],
    ['an unparseable host', 'wsl:Ubuntu']
  ])('cannot tell for %s, without asking the owning runtime', async (_label, executionHostId) => {
    await expect(
      createWebAiVaultApi().droidSessionHolder({ ...OWN, executionHostId })
    ).resolves.toBe('unverifiable')
    expect(callRuntimeResult).not.toHaveBeenCalled()
  })

  it('cannot tell on a runtime that predates the method', async () => {
    callRuntimeResult.mockRejectedValue(
      Object.assign(new Error('unknown method'), { code: 'method_not_found' })
    )

    await expect(createWebAiVaultApi().droidSessionHolder(OWN)).resolves.toBe('unverifiable')
  })

  it.each([
    ['nothing', undefined],
    ['an empty object', {}]
  ])('cannot tell when the runtime answers %s', async (_label, reply) => {
    callRuntimeResult.mockResolvedValue(reply)

    await expect(createWebAiVaultApi().droidSessionHolder(OWN)).resolves.toBe('unverifiable')
  })
})
