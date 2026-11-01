import { describe, expect, it, vi } from 'vitest'
import { REAL_DROID_CLI_TEST_ENV, resolveRealDroidCliGate } from './droid-real-cli-test-gate'

describe('resolveRealDroidCliGate', () => {
  it('skips without the opt-in and never starts the CLI', () => {
    const runDroid = vi.fn(() => ({ status: 0 }))

    const gate = resolveRealDroidCliGate({}, 'darwin', runDroid)

    expect(gate.skipReason).toContain(REAL_DROID_CLI_TEST_ENV)
    expect(runDroid).not.toHaveBeenCalled()
  })

  it('only accepts the value 1', () => {
    const runDroid = vi.fn(() => ({ status: 0 }))

    const gate = resolveRealDroidCliGate({ [REAL_DROID_CLI_TEST_ENV]: 'true' }, 'linux', runDroid)

    expect(gate.skipReason).not.toBeNull()
    expect(runDroid).not.toHaveBeenCalled()
  })

  it('skips on Windows, where the POSIX hook script does not run', () => {
    const runDroid = vi.fn(() => ({ status: 0 }))

    const gate = resolveRealDroidCliGate({ [REAL_DROID_CLI_TEST_ENV]: '1' }, 'win32', runDroid)

    expect(gate.skipReason).not.toBeNull()
    expect(runDroid).not.toHaveBeenCalled()
  })

  it('skips when the CLI is missing or broken', () => {
    const gate = resolveRealDroidCliGate({ [REAL_DROID_CLI_TEST_ENV]: '1' }, 'darwin', () => ({
      status: null
    }))

    expect(gate.skipReason).toBe('`droid --version` failed')
  })

  it('runs when opted in and the CLI answers', () => {
    const runDroid = vi.fn(() => ({ status: 0 }))

    const gate = resolveRealDroidCliGate({ [REAL_DROID_CLI_TEST_ENV]: '1' }, 'darwin', runDroid)

    expect(gate.skipReason).toBeNull()
    expect(runDroid).toHaveBeenCalledWith(['--version'])
  })
})
