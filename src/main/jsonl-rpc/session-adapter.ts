import { randomUUID } from 'node:crypto'
import { waitForPromiseWithSignal } from '../../shared/abort-signal-reason'
import type { AgentSessionProviderHandleLink } from '../../shared/agent-session-provider-handle'
import type { AgentModelCatalogLiveListing } from '../native-chat/agent-model-catalog/agent-model-catalog-entry'
import {
  AgentSessionAcquisitionExitProvenError,
  AgentSessionAcquisitionExitUnprovenError,
  AgentSessionAcquisitionRootExitObservedError,
  AgentSessionPreSpawnError,
  type AgentSessionAcquisition,
  type StructuredAgentSessionAcquireInput,
  type StructuredAgentSessionAdapter
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { DescendantTreeVerdict } from '../pty-descendant-exit-verification'
import { ProviderAcquisitionStarts } from '../provider-process/provider-acquisition-starts'
import type { ProviderProcessCloseResult } from '../provider-process/provider-process-close'
import { providerSpawnedProcessIdentity } from '../provider-process/provider-spawned-process-identity'
import { supportsSupervisedProviderChildLocation } from '../provider-process/supervised-provider-child-location'

export type JsonlRpcHostedConnection = {
  readonly pid: number | undefined
  readonly closed: boolean
  readonly rootVerdict: DescendantTreeVerdict
  readonly processless: boolean
  close(): Promise<ProviderProcessCloseResult>
  onExit(listener: () => void): void
  request(method: string, params: unknown, options: { timeoutMs: number }): Promise<unknown>
}

export type JsonlRpcHostedSession = {
  readonly input: StructuredAgentSessionAcquireInput
  readonly generation: string
  readonly connection: JsonlRpcHostedConnection
  readonly lane: { readonly openTurnId: string | null }
  readonly turns: { readonly holdsDispatch: boolean; stop(): void }
  /** The agent's own id for the conversation this child now holds. */
  start(): Promise<string>
  close(requested?: boolean): Promise<ProviderProcessCloseResult>
  fail(error: Error): void
  retire(): Promise<void>
  drainObservedExit(): Promise<void>
}

export type JsonlRpcSessionAdapterNames = {
  agent: string
  /** Names the agent in errors and logs: `Pi`. */
  label: string
  /** Names the child in the process identity it records: `Pi RPC`. */
  spawnLabel: string
}

/**
 * What every JSON-RPC child adapter shares: one child per session, the start that races the host's
 * abort, the close that must prove the exit, and the stop that interrupts a turn.
 */
export abstract class JsonlRpcSessionAdapter<S extends JsonlRpcHostedSession, L> {
  protected readonly sessions = new Map<string, S>()
  private readonly acquiring = new Set<string>()
  private readonly starts = new ProviderAcquisitionStarts<S['connection']>()
  private readonly retiring = new Set<Promise<void>>()

  protected constructor(
    private readonly names: JsonlRpcSessionAdapterNames,
    private readonly readProcessStartTime?: (pid: number) => Promise<number | null>
  ) {}

  supportsLocation = supportsSupervisedProviderChildLocation
  supportsCreate: NonNullable<StructuredAgentSessionAdapter['supportsCreate']> = (
    location,
    agent
  ) => agent === this.names.agent && this.supportsLocation(location)

  protected abstract readonly interruptMethod: string
  protected abstract resolveLaunch(
    identity: StructuredAgentSessionAcquireInput['identity']
  ): Promise<L>
  /** Builds the child's launch and its session; a throw here is a refusal before any spawn. */
  protected abstract openSession(
    input: StructuredAgentSessionAcquireInput,
    launch: L,
    generation: string
  ): S
  protected abstract link(
    launch: L,
    nativeId: string,
    fence: number,
    linkId: string,
    at: number
  ): AgentSessionProviderHandleLink
  protected abstract startListing(session: S): AgentModelCatalogLiveListing | undefined
  protected abstract withdrawPrompts(session: S): void
  /** A start error that must reach the person as it is, even after the child it killed is gone. */
  protected keepsRefusal(_error: unknown): boolean {
    return false
  }

  async acquire(input: StructuredAgentSessionAcquireInput): Promise<AgentSessionAcquisition> {
    const { label, spawnLabel } = this.names
    const id = input.identity.sessionId
    if (this.acquiring.has(id)) {
      throw new AgentSessionPreSpawnError(new Error(`${label} session already owns a child`))
    }
    this.acquiring.add(id)
    const attempt = this.starts.begin(input.signal)
    let session: S | undefined
    try {
      if (attempt.signal.aborted) {
        throw new AgentSessionPreSpawnError(new Error(`${label} closed while starting`))
      }
      if (!(await this.starts.stopFailed(id))) {
        throw new AgentSessionAcquisitionExitUnprovenError(
          new Error(`Previous ${label} start has not exited`)
        )
      }
      const previous = this.sessions.get(id)
      if (previous?.connection.closed && previous.connection.rootVerdict === 'exited') {
        this.acknowledgeSessionRelease(id)
      } else if (previous) {
        throw new AgentSessionPreSpawnError(new Error(`${label} session already owns a child`))
      }
      let launch: L
      try {
        launch = await waitForPromiseWithSignal(this.resolveLaunch(input.identity), attempt.signal)
      } catch (error) {
        throw new AgentSessionPreSpawnError(error)
      }
      if (attempt.signal.aborted) {
        throw new AgentSessionPreSpawnError(new Error(`${label} closed while starting`))
      }
      session = this.openSession(input, launch, randomUUID())
      this.sessions.set(id, session)
      this.starts.track(attempt, session.connection)
      const spawned = providerSpawnedProcessIdentity(input, spawnLabel, this.readProcessStartTime)
      if (session.connection.pid !== undefined) {
        await spawned.onSpawned(session.connection.pid)
      }
      const process = await spawned.read(session.connection.pid)
      const nativeId = await waitForPromiseWithSignal(session.start(), attempt.signal)
      if (session.connection.closed || attempt.signal.aborted) {
        throw new Error(`${label} exited while starting`)
      }
      const catalogListing = this.startListing(session)
      return {
        process,
        acquisitionGeneration: session.generation,
        link: this.link(launch, nativeId, input.fence, randomUUID(), Date.now()),
        ...(catalogListing ? { catalogListing } : {})
      }
    } catch (error) {
      if (!session) {
        throw error instanceof AgentSessionPreSpawnError ||
          error instanceof AgentSessionAcquisitionExitUnprovenError
          ? error
          : new AgentSessionPreSpawnError(error)
      }
      const result = await session.close(false).catch(() => null)
      if (result?.root === 'exited') {
        if (this.keepsRefusal(error)) {
          throw error
        }
        if (session.connection.processless) {
          throw new AgentSessionAcquisitionExitProvenError(error)
        }
        throw new AgentSessionAcquisitionRootExitObservedError(error)
      }
      this.starts.retainFailed(id, session.connection)
      throw new AgentSessionAcquisitionExitUnprovenError(error)
    } finally {
      this.starts.end(attempt)
      this.acquiring.delete(id)
    }
  }

  cancelTurn: StructuredAgentSessionAdapter['cancelTurn'] = async (input) => {
    const session = this.session(input.sessionId, input.fence)
    const turnId = input.resolveLiveTurnId ? input.resolveLiveTurnId() : session.lane.openTurnId
    if (input.turnId !== undefined && input.turnId !== turnId) {
      return { cancelled: false }
    }
    if (!turnId && !session.turns.holdsDispatch) {
      return { cancelled: false }
    }
    session.turns.stop()
    this.withdrawPrompts(session)
    await session.connection.request(this.interruptMethod, {}, { timeoutMs: 2_000 })
    return { cancelled: true, ...(turnId ? { turnId } : {}) }
  }

  stopEndsSession(): boolean {
    return true
  }

  routePromptCancel(): { kind: 'dismiss' } {
    return { kind: 'dismiss' }
  }

  holdsDispatch(id: string): boolean {
    return this.sessions.get(id)?.turns.holdsDispatch ?? false
  }

  async closeSession(id: string, requested = true): Promise<boolean> {
    const session = this.sessions.get(id)
    if (!session) {
      return true
    }
    const result = await session.close(requested)
    if (result.root !== 'exited') {
      return false
    }
    if (result.tree !== 'exited') {
      throw new AgentSessionAcquisitionRootExitObservedError(
        new Error(`${this.names.label} root exit observed`)
      )
    }
    return true
  }

  releaseAcquisition(input: { sessionId: string }): Promise<boolean> {
    return this.closeSession(input.sessionId)
  }

  forceCloseSession(id: string): Promise<boolean> {
    this.sessions.get(id)?.fail(new Error(`${this.names.label} event sink failed`))
    return this.closeSession(id, false)
  }

  disposeSession(id: string): Promise<boolean> {
    return this.closeSession(id)
  }

  acknowledgeSessionRelease(id: string): void {
    const session = this.sessions.get(id)
    if (!session?.connection.closed || session.connection.rootVerdict !== 'exited') {
      return
    }
    this.sessions.delete(id)
    const retirement = session.retire()
    this.retiring.add(retirement)
    void retirement.then(() => this.retiring.delete(retirement))
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.closeSession(id)))
  }

  async drainObservedExits(): Promise<void> {
    await Promise.all([
      ...this.retiring,
      ...[...this.sessions.values()].map((session) => session.drainObservedExit())
    ])
  }

  protected session(id: string, fence: number): S {
    const session = this.sessions.get(id)
    if (!session || session.input.fence !== fence || session.connection.closed) {
      throw new Error(`${this.names.label} session is not live under this fence`)
    }
    return session
  }
}
