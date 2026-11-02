import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakePipedChild } from '../../shared/__fixtures__/fake-spawned-child'
import { spawnManagedProviderProcess } from './managed-provider-process'
import type { ProviderProcessTeardownVerdict } from './provider-process-teardown'

const teardown = vi.hoisted(() => ({
  terminate: vi.fn(async (): Promise<ProviderProcessTeardownVerdict> => null)
}))
vi.mock('./provider-process-teardown', () => ({
  terminateProviderProcessTree: teardown.terminate
}))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('managed provider stop budgets', () => {
  it.each([1_000, 3_000])(
    'waits the %i ms stdin grace plus group cleanup before forcing',
    async (stdinEndGraceMs) => {
      vi.useFakeTimers()
      const child = createFakePipedChild(9_999_999)
      const managed = spawnManagedProviderProcess(
        { command: 'fixture-provider', args: [] },
        { site: 'fixture', platform: 'linux', spawnImpl: () => child, stdinEndGraceMs }
      )
      const close = managed.close()
      await vi.advanceTimersByTimeAsync(stdinEndGraceMs + 3_000 + 1_500 - 1)
      expect(teardown.terminate).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(teardown.terminate).toHaveBeenCalledOnce()
      child.emit('exit', 0, null)
      await expect(close).resolves.toMatchObject({ root: 'exited' })
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('rejects an explicit close policy that would kill the supervisor during its longer grace', () => {
    const spawnImpl = vi.fn()
    expect(() =>
      spawnManagedProviderProcess(
        { command: 'fixture-provider', args: [] },
        {
          site: 'fixture',
          platform: 'linux',
          spawnImpl,
          stdinEndGraceMs: 3_000,
          policy: () => ({ gracefulExitMs: 5_500, forcedExitMs: 50 })
        }
      )
    ).toThrow('at least 7500 ms')
    expect(spawnImpl).not.toHaveBeenCalled()
  })
})
