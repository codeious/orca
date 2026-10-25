import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import { droidProviderLink } from '../droid/droid-structured-launch-resolution'
import type { AgentModelCatalogLiveListing } from '../native-chat/agent-model-catalog/agent-model-catalog-entry'
import {
  AgentSessionAcquisitionExitProvenError,
  AgentSessionAcquisitionExitUnprovenError,
  AgentSessionAcquisitionRootExitObservedError,
  AgentSessionPreSpawnError,
  type StructuredAgentSessionAcquireInput
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { ProviderProcessCloseResult } from '../provider-process/provider-process-close'
import {
  JsonlRpcSessionAdapter,
  type JsonlRpcHostedConnection,
  type JsonlRpcHostedSession
} from './session-adapter'

const exited: ProviderProcessCloseResult = { root: 'exited', tree: 'exited' }

class ToyConnection implements JsonlRpcHostedConnection {
  pid: number | undefined = 4242
  closed = false
  rootVerdict: ProviderProcessCloseResult['root'] = 'live'
  processless = false
  closeResult: ProviderProcessCloseResult = exited
  readonly requests: { method: string; timeoutMs: number }[] = []
  private readonly exitListeners: (() => void)[] = []
  async request(method: string, _params: unknown, options: { timeoutMs: number }) {
    this.requests.push({ method, timeoutMs: options.timeoutMs })
    return {}
  }
  async close(): Promise<ProviderProcessCloseResult> {
    this.closed = true
    this.rootVerdict = this.closeResult.root
    if (this.closeResult.root === 'exited') {
      this.exit()
    }
    return this.closeResult
  }
  onExit(listener: () => void): void {
    this.exitListeners.push(listener)
  }
  exit(): void {
    this.closed = true
    this.rootVerdict = 'exited'
    for (const listener of this.exitListeners.splice(0)) {
      listener()
    }
  }
}

class ToySession implements JsonlRpcHostedSession {
  readonly connection = new ToyConnection()
  readonly lane: { openTurnId: string | null } = { openTurnId: null }
  readonly turns = { holdsDispatch: false, stop: vi.fn() }
  start = vi.fn(async () => 'native-1')
  fail = vi.fn()
  drainObservedExit = vi.fn(async () => undefined)
  retire = vi.fn(async () => undefined)
  closeRequests: (boolean | undefined)[] = []
  constructor(
    readonly input: StructuredAgentSessionAcquireInput,
    readonly generation: string
  ) {}
  close(requested?: boolean): Promise<ProviderProcessCloseResult> {
    this.closeRequests.push(requested)
    return this.connection.close()
  }
}

type Launch = { nativeId: string }

class ToyAdapter extends JsonlRpcSessionAdapter<ToySession, Launch> {
  readonly opened: ToySession[] = []
  readonly withdrawn: ToySession[] = []
  resolve: () => Promise<Launch> = async () => ({ nativeId: 'native-1' })
  open: (input: StructuredAgentSessionAcquireInput) => ToySession = (input) => {
    const session = new ToySession(input, `generation-${this.opened.length + 1}`)
    this.opened.push(session)
    return session
  }
  refusals: (error: unknown) => boolean = () => false
  listing: AgentModelCatalogLiveListing | undefined
  protected readonly interruptMethod = 'toy.interrupt'

  constructor() {
    super({ agent: 'toy', label: 'Toy', spawnLabel: 'Toy exec' }, async () => 12345)
  }
  protected resolveLaunch(): Promise<Launch> {
    return this.resolve()
  }
  protected openSession(input: StructuredAgentSessionAcquireInput): ToySession {
    return this.open(input)
  }
  protected link(launch: Launch, nativeId: string, fence: number, linkId: string, at: number) {
    return droidProviderLink({ previous: null }, nativeId || launch.nativeId, fence, linkId, at)
  }
  protected startListing() {
    return this.listing
  }
  protected withdrawPrompts(session: ToySession): void {
    this.withdrawn.push(session)
  }
  protected keepsRefusal(error: unknown): boolean {
    return this.refusals(error)
  }
  sessionFor(id: string): ToySession | undefined {
    return this.sessions.get(id)
  }
  liveSession(id: string, fence: number): ToySession {
    return this.session(id, fence)
  }
}

function acquireInput(
  overrides: Partial<StructuredAgentSessionAcquireInput> = {}
): StructuredAgentSessionAcquireInput {
  return {
    identity: {
      sessionId: 'session-1',
      workspaceId: 'folder-1',
      hostId: 'local',
      agent: 'droid',
      providerHandle: null
    },
    fence: 7,
    spawnToken: 'spawn-token',
    onSpawned: async () => undefined,
    ...overrides
  }
}

describe('a JSON-RPC session adapter', () => {
  it('opens a child, starts it, and answers with the child it holds', async () => {
    const adapter = new ToyAdapter()

    const acquired = await adapter.acquire(acquireInput())

    expect(acquired).toMatchObject({
      process: { pid: 4242, processStartTimeMs: 12345, spawnToken: 'spawn-token' },
      acquisitionGeneration: 'generation-1',
      link: { handle: { nativeId: 'native-1' }, mintedAtFence: 7 }
    })
    expect(adapter.sessionFor('session-1')).toBe(adapter.opened[0])
    expect(acquired).not.toHaveProperty('catalogListing')
  })

  it('hands the host the model listing the child reported at start', async () => {
    const adapter = new ToyAdapter()
    adapter.listing = { models: [] }

    const acquired = await adapter.acquire(acquireInput())

    expect(acquired.catalogListing).toBe(adapter.listing)
  })

  it('reports the child to the host as soon as it spawns, before it starts', async () => {
    const adapter = new ToyAdapter()
    const onSpawned = vi.fn(async () => {
      expect(adapter.opened[0]?.start).not.toHaveBeenCalled()
    })

    await adapter.acquire(acquireInput({ onSpawned }))

    expect(onSpawned).toHaveBeenCalledTimes(1)
  })

  it('refuses a second acquire for a session that already owns a child', async () => {
    const adapter = new ToyAdapter()
    await adapter.acquire(acquireInput())

    await expect(adapter.acquire(acquireInput())).rejects.toThrow(
      new AgentSessionPreSpawnError(new Error('Toy session already owns a child'))
    )
  })

  it('refuses a concurrent acquire for the same session', async () => {
    const adapter = new ToyAdapter()
    let release: (launch: Launch) => void = () => undefined
    adapter.resolve = () => new Promise((resolve) => (release = resolve))

    const first = adapter.acquire(acquireInput())
    await expect(adapter.acquire(acquireInput())).rejects.toBeInstanceOf(AgentSessionPreSpawnError)
    release({ nativeId: 'native-1' })

    await expect(first).resolves.toBeDefined()
  })

  it('replaces a child that has exited, and retires it', async () => {
    const adapter = new ToyAdapter()
    await adapter.acquire(acquireInput())
    const previous = adapter.opened[0]
    previous?.connection.exit()

    await adapter.acquire(acquireInput())

    expect(previous?.retire).toHaveBeenCalledTimes(1)
    expect(adapter.sessionFor('session-1')).toBe(adapter.opened[1])
  })

  it('refuses before spawning when the host already aborted the start', async () => {
    const adapter = new ToyAdapter()
    const controller = new AbortController()
    controller.abort()

    await expect(adapter.acquire(acquireInput({ signal: controller.signal }))).rejects.toThrow(
      'Toy closed while starting'
    )
    expect(adapter.opened).toHaveLength(0)
  })

  it('refuses before spawning when the launch cannot be resolved', async () => {
    const adapter = new ToyAdapter()
    adapter.resolve = () => Promise.reject(new Error('no binary'))

    const failure = await adapter.acquire(acquireInput()).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AgentSessionPreSpawnError)
    expect(adapter.opened).toHaveLength(0)
  })

  it('refuses before spawning when the child cannot be opened', async () => {
    const adapter = new ToyAdapter()
    adapter.open = () => {
      throw new Error('bad launch')
    }

    await expect(adapter.acquire(acquireInput())).rejects.toBeInstanceOf(AgentSessionPreSpawnError)
    expect(adapter.sessionFor('session-1')).toBeUndefined()
  })

  it('stops a child whose start failed and says its exit was proven when it had no process', async () => {
    const adapter = new ToyAdapter()
    adapter.open = (input) => {
      const session = new ToySession(input, 'generation-1')
      session.connection.processless = true
      session.start.mockRejectedValue(new Error('handshake failed'))
      adapter.opened.push(session)
      return session
    }

    await expect(adapter.acquire(acquireInput())).rejects.toBeInstanceOf(
      AgentSessionAcquisitionExitProvenError
    )
    expect(adapter.opened[0]?.closeRequests).toEqual([false])
  })

  it('says only the root exit was observed when the failed child had a process', async () => {
    const adapter = new ToyAdapter()
    adapter.open = (input) => {
      const session = new ToySession(input, 'generation-1')
      session.start.mockRejectedValue(new Error('handshake failed'))
      adapter.opened.push(session)
      return session
    }

    await expect(adapter.acquire(acquireInput())).rejects.toBeInstanceOf(
      AgentSessionAcquisitionRootExitObservedError
    )
  })

  it('keeps a refusal the adapter names as the start error once the child is gone', async () => {
    const adapter = new ToyAdapter()
    const refusal = new Error('update your release')
    adapter.refusals = (error) => error === refusal
    adapter.open = (input) => {
      const session = new ToySession(input, 'generation-1')
      session.start.mockRejectedValue(refusal)
      adapter.opened.push(session)
      return session
    }

    await expect(adapter.acquire(acquireInput())).rejects.toBe(refusal)
  })

  it('does not keep a refusal nobody named', async () => {
    const adapter = new ToyAdapter()
    const refusal = new Error('update your release')
    adapter.open = (input) => {
      const session = new ToySession(input, 'generation-1')
      session.start.mockRejectedValue(refusal)
      adapter.opened.push(session)
      return session
    }

    await expect(adapter.acquire(acquireInput())).rejects.toBeInstanceOf(
      AgentSessionAcquisitionRootExitObservedError
    )
  })

  it('will not start again over a failed child whose exit is not proven', async () => {
    const adapter = new ToyAdapter()
    adapter.open = (input) => {
      const session = new ToySession(input, `generation-${adapter.opened.length + 1}`)
      session.connection.closeResult = { root: 'live', tree: null }
      session.start.mockRejectedValue(new Error('handshake failed'))
      adapter.opened.push(session)
      return session
    }

    await expect(adapter.acquire(acquireInput())).rejects.toBeInstanceOf(
      AgentSessionAcquisitionExitUnprovenError
    )
    await expect(adapter.acquire(acquireInput())).rejects.toThrow(
      new AgentSessionAcquisitionExitUnprovenError(new Error('Previous Toy start has not exited'))
    )
    expect(adapter.opened).toHaveLength(1)
  })

  it('stops a child the host aborts while it starts', async () => {
    const adapter = new ToyAdapter()
    const controller = new AbortController()
    adapter.open = (input) => {
      const session = new ToySession(input, 'generation-1')
      session.start.mockImplementation(async () => {
        controller.abort()
        return 'native-1'
      })
      adapter.opened.push(session)
      return session
    }

    await expect(adapter.acquire(acquireInput({ signal: controller.signal }))).rejects.toThrow()
    expect(adapter.opened[0]?.connection.closed).toBe(true)
  })

  it('closes a session: true when none is held, false while the root lives, an error if the tree does', async () => {
    const adapter = new ToyAdapter()
    expect(await adapter.closeSession('session-1')).toBe(true)
    await adapter.acquire(acquireInput())
    const connection = adapter.opened[0]?.connection

    if (!connection) {
      throw new Error('no connection')
    }
    connection.closeResult = { root: 'live', tree: null }
    expect(await adapter.closeSession('session-1')).toBe(false)
    connection.closeResult = { root: 'exited', tree: 'live' }
    await expect(adapter.closeSession('session-1')).rejects.toBeInstanceOf(
      AgentSessionAcquisitionRootExitObservedError
    )
    connection.closeResult = exited
    expect(await adapter.closeSession('session-1')).toBe(true)
  })

  it('marks a close as requested unless the caller says it was not', async () => {
    const adapter = new ToyAdapter()
    await adapter.acquire(acquireInput())

    await adapter.closeSession('session-1')
    await adapter.closeSession('session-1', false)

    expect(adapter.opened[0]?.closeRequests).toEqual([true, false])
  })

  it('fails a session whose event sink failed, then closes it unrequested', async () => {
    const adapter = new ToyAdapter()
    await adapter.acquire(acquireInput())

    await adapter.forceCloseSession('session-1')

    expect(adapter.opened[0]?.fail).toHaveBeenCalledWith(new Error('Toy event sink failed'))
    expect(adapter.opened[0]?.closeRequests).toEqual([false])
  })

  it('closes on release and on dispose', async () => {
    const adapter = new ToyAdapter()
    await adapter.acquire(acquireInput())

    await adapter.releaseAcquisition({ sessionId: 'session-1' })
    await adapter.disposeSession('session-1')

    expect(adapter.opened[0]?.closeRequests).toEqual([true, true])
  })

  it('forgets a session only once its root exit is proven', async () => {
    const adapter = new ToyAdapter()
    await adapter.acquire(acquireInput())
    const session = adapter.opened[0]
    if (!session) {
      throw new Error('no session')
    }

    adapter.acknowledgeSessionRelease('session-1')
    expect(adapter.sessionFor('session-1')).toBe(session)

    session.connection.exit()
    adapter.acknowledgeSessionRelease('session-1')
    expect(adapter.sessionFor('session-1')).toBeUndefined()
    expect(session.retire).toHaveBeenCalledTimes(1)
  })

  it('waits for retiring and live sessions to publish their exits', async () => {
    const adapter = new ToyAdapter()
    await adapter.acquire(acquireInput())
    await adapter.acquire(
      acquireInput({ identity: { ...acquireInput().identity, sessionId: 's2' } })
    )
    const [first, second] = adapter.opened
    first?.connection.exit()
    let releaseRetire: () => void = () => undefined
    first?.retire.mockReturnValue(
      new Promise<undefined>((resolve) => (releaseRetire = () => resolve(undefined)))
    )
    adapter.acknowledgeSessionRelease('session-1')

    let drained = false
    const draining = adapter.drainObservedExits().then(() => (drained = true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(drained).toBe(false)
    releaseRetire()
    await draining

    expect(second?.drainObservedExit).toHaveBeenCalled()
  })

  it('closes every session it holds', async () => {
    const adapter = new ToyAdapter()
    await adapter.acquire(acquireInput())
    await adapter.acquire(
      acquireInput({ identity: { ...acquireInput().identity, sessionId: 's2' } })
    )

    await adapter.closeAll()

    expect(adapter.opened.map((session) => session.connection.closed)).toEqual([true, true])
  })

  it('hands out a session only under its own fence and while its connection is open', async () => {
    const adapter = new ToyAdapter()
    await adapter.acquire(acquireInput())

    expect(adapter.liveSession('session-1', 7)).toBe(adapter.opened[0])
    expect(() => adapter.liveSession('session-1', 8)).toThrow(
      'Toy session is not live under this fence'
    )
    expect(() => adapter.liveSession('other', 7)).toThrow(
      'Toy session is not live under this fence'
    )
    adapter.opened[0]?.connection.exit()
    expect(() => adapter.liveSession('session-1', 7)).toThrow(
      'Toy session is not live under this fence'
    )
  })

  it('reports whether a session holds a dispatch', async () => {
    const adapter = new ToyAdapter()
    await adapter.acquire(acquireInput())

    expect(adapter.holdsDispatch('session-1')).toBe(false)
    if (adapter.opened[0]) {
      adapter.opened[0].turns.holdsDispatch = true
    }
    expect(adapter.holdsDispatch('session-1')).toBe(true)
    expect(adapter.holdsDispatch('unknown')).toBe(false)
  })

  it('supports its own agent on a location it can supervise', () => {
    const adapter = new ToyAdapter()
    const local: AgentSessionExecutionLocation = {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'folder-1',
      workspaceKind: 'folder'
    }

    expect(adapter.supportsCreate(local, 'toy')).toBe(true)
    expect(adapter.supportsCreate(local, 'other')).toBe(false)
    expect(adapter.supportsCreate({ ...local, executionHostId: 'ssh:remote' }, 'toy')).toBe(false)
  })

  describe('cancelling a turn', () => {
    async function running(turnId: string | null = 'turn-1') {
      const adapter = new ToyAdapter()
      await adapter.acquire(acquireInput())
      const session = adapter.opened[0]
      if (!session) {
        throw new Error('no session')
      }
      session.lane.openTurnId = turnId
      return { adapter, session }
    }

    it('stops the turn, withdraws its prompts, and interrupts the child within two seconds', async () => {
      const { adapter, session } = await running()

      const result = await adapter.cancelTurn({ sessionId: 'session-1', fence: 7 })

      expect(result).toEqual({ cancelled: true, turnId: 'turn-1' })
      expect(session.turns.stop).toHaveBeenCalledTimes(1)
      expect(adapter.withdrawn).toEqual([session])
      expect(session.connection.requests).toEqual([{ method: 'toy.interrupt', timeoutMs: 2_000 }])
    })

    it('does nothing for a turn that is not the open one', async () => {
      const { adapter, session } = await running()

      const result = await adapter.cancelTurn({ sessionId: 'session-1', fence: 7, turnId: 'old' })

      expect(result).toEqual({ cancelled: false })
      expect(session.connection.requests).toEqual([])
    })

    it('does nothing when no turn is open and no dispatch is held', async () => {
      const { adapter, session } = await running(null)

      expect(await adapter.cancelTurn({ sessionId: 'session-1', fence: 7 })).toEqual({
        cancelled: false
      })
      expect(session.turns.stop).not.toHaveBeenCalled()
    })

    it('cancels a held dispatch before any turn opens', async () => {
      const { adapter, session } = await running(null)
      session.turns.holdsDispatch = true

      expect(await adapter.cancelTurn({ sessionId: 'session-1', fence: 7 })).toEqual({
        cancelled: true
      })
    })

    it('asks the host which turn is live when it can say', async () => {
      const { adapter } = await running('turn-1')

      const result = await adapter.cancelTurn({
        sessionId: 'session-1',
        fence: 7,
        turnId: 'turn-2',
        resolveLiveTurnId: () => 'turn-2'
      })

      expect(result).toEqual({ cancelled: true, turnId: 'turn-2' })
    })
  })

  it('ends the session on a stop and dismisses a cancelled prompt', () => {
    const adapter = new ToyAdapter()

    expect(adapter.stopEndsSession()).toBe(true)
    expect(adapter.routePromptCancel()).toEqual({ kind: 'dismiss' })
  })
})
