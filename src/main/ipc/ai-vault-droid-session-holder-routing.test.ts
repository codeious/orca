import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcHandle = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ ipcMain: { handle: ipcHandle } }))

const {
  AI_VAULT_DROID_SESSION_HOLDER_CHANNEL,
  registerAiVaultDroidSessionHolderHandler,
  resolveAiVaultDroidSessionHolderByHost
} = await import('./ai-vault-droid-session-holder-routing')

const SESSION = 'droid-session'

function readers() {
  return {
    readLocal: vi.fn(async (_sessionId: string): Promise<'live' | 'unverifiable' | null> => null),
    readRuntime: vi.fn(
      async (_environmentId: string, _sessionId: string): Promise<'live' | 'unverifiable' | null> =>
        null
    )
  }
}

beforeEach(() => {
  ipcHandle.mockReset()
})

describe('resolveAiVaultDroidSessionHolderByHost', () => {
  it.each(['live', 'unverifiable', null] as const)(
    'asks this machine for a local session and relays %s',
    async (answer) => {
      const r = readers()
      r.readLocal.mockResolvedValue(answer)

      await expect(
        resolveAiVaultDroidSessionHolderByHost({ executionHostId: 'local', sessionId: SESSION }, r)
      ).resolves.toBe(answer)
      expect(r.readLocal).toHaveBeenCalledWith(SESSION)
      expect(r.readRuntime).not.toHaveBeenCalled()
    }
  )

  it.each(['live', 'unverifiable', null] as const)(
    'asks the paired host that owns a runtime session and relays %s',
    async (answer) => {
      const r = readers()
      r.readRuntime.mockResolvedValue(answer)

      await expect(
        resolveAiVaultDroidSessionHolderByHost(
          { executionHostId: 'runtime:env-1', sessionId: SESSION },
          r
        )
      ).resolves.toBe(answer)
      expect(r.readRuntime).toHaveBeenCalledWith('env-1', SESSION)
      expect(r.readLocal).not.toHaveBeenCalled()
    }
  )

  it('never probes this machine for an SSH session', async () => {
    const r = readers()

    await expect(
      resolveAiVaultDroidSessionHolderByHost(
        { executionHostId: 'ssh:build-box', sessionId: SESSION },
        r
      )
    ).resolves.toBe('unverifiable')
    expect(r.readLocal).not.toHaveBeenCalled()
    expect(r.readRuntime).not.toHaveBeenCalled()
  })

  it('never dials the unresolved-owner sentinel', async () => {
    const r = readers()

    await expect(
      resolveAiVaultDroidSessionHolderByHost(
        { executionHostId: 'runtime:unresolved-owner', sessionId: SESSION },
        r
      )
    ).resolves.toBe('unverifiable')
    expect(r.readLocal).not.toHaveBeenCalled()
    expect(r.readRuntime).not.toHaveBeenCalled()
  })

  it.each([
    ['an empty host id', ''],
    ['an unknown host kind', 'wsl:Ubuntu'],
    ['a malformed runtime host', 'runtime:']
  ])('cannot tell for %s, and does not guess local', async (_label, executionHostId) => {
    const r = readers()

    await expect(
      resolveAiVaultDroidSessionHolderByHost({ executionHostId, sessionId: SESSION }, r)
    ).resolves.toBe('unverifiable')
    expect(r.readLocal).not.toHaveBeenCalled()
    expect(r.readRuntime).not.toHaveBeenCalled()
  })

  it('cannot tell when no reader is wired for the session host', async () => {
    await expect(
      resolveAiVaultDroidSessionHolderByHost({ executionHostId: 'local', sessionId: SESSION }, {})
    ).resolves.toBe('unverifiable')
    await expect(
      resolveAiVaultDroidSessionHolderByHost(
        { executionHostId: 'runtime:env-1', sessionId: SESSION },
        {}
      )
    ).resolves.toBe('unverifiable')
  })

  it('cannot tell when a reader fails, never null', async () => {
    const r = readers()
    r.readLocal.mockRejectedValue(new Error('probe crashed'))
    r.readRuntime.mockRejectedValue(new Error('socket closed'))

    await expect(
      resolveAiVaultDroidSessionHolderByHost({ executionHostId: 'local', sessionId: SESSION }, r)
    ).resolves.toBe('unverifiable')
    await expect(
      resolveAiVaultDroidSessionHolderByHost(
        { executionHostId: 'runtime:env-1', sessionId: SESSION },
        r
      )
    ).resolves.toBe('unverifiable')
  })
})

describe('the aiVault droid session holder IPC channel', () => {
  function registeredHandler(r: ReturnType<typeof readers>) {
    registerAiVaultDroidSessionHolderHandler({
      readLocalDroidSessionHolder: r.readLocal,
      readRuntimeDroidSessionHolder: r.readRuntime
    })
    expect(ipcHandle).toHaveBeenCalledWith(
      AI_VAULT_DROID_SESSION_HOLDER_CHANNEL,
      expect.any(Function)
    )
    const [, handler] = ipcHandle.mock.calls[0]
    return (args: unknown) => handler({}, args) as Promise<unknown>
  }

  it('answers in the shape the host RPC uses', async () => {
    const r = readers()
    r.readLocal.mockResolvedValue('live')

    await expect(
      registeredHandler(r)({ executionHostId: 'local', sessionId: SESSION })
    ).resolves.toEqual({ holder: 'live' })
  })

  it('keeps a proven-free answer distinct from cannot-tell on the wire', async () => {
    const r = readers()

    await expect(
      registeredHandler(r)({ executionHostId: 'local', sessionId: SESSION })
    ).resolves.toEqual({ holder: null })
  })

  it.each([
    ['no arguments', undefined],
    ['a null argument', null],
    ['a bare string', SESSION],
    ['a missing session id', { executionHostId: 'local' }],
    ['an empty session id', { executionHostId: 'local', sessionId: '' }],
    ['an unbounded session id', { executionHostId: 'local', sessionId: 'x'.repeat(513) }],
    ['a non-string host id', { executionHostId: 7, sessionId: SESSION }]
  ])('cannot tell for %s, without asking anyone', async (_label, args) => {
    const r = readers()

    await expect(registeredHandler(r)(args)).resolves.toEqual({ holder: 'unverifiable' })
    expect(r.readLocal).not.toHaveBeenCalled()
    expect(r.readRuntime).not.toHaveBeenCalled()
  })
})
