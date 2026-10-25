import { randomUUID } from 'node:crypto'
import { waitForPromiseWithSignal } from '../../shared/abort-signal-reason'
import { agentSessionFailureWords } from '../../shared/agent-session-failure-words'
import {
  AgentSessionAcquisitionExitProvenError,
  AgentSessionAcquisitionExitUnprovenError,
  AgentSessionAcquisitionRootExitObservedError,
  AgentSessionPreSpawnError,
  AgentSessionPromptAnswerRejectedError,
  type AgentSessionAcquisition,
  type StructuredAgentSessionAcquireInput,
  type StructuredAgentSessionAdapter
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { AgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import { isAgentSessionPreSpawnError } from '../native-chat/agent-session-wire/structured-agent-session-pre-spawn-error'
import { ProviderAcquisitionStarts } from '../provider-process/provider-acquisition-starts'
import { providerSpawnedProcessIdentity } from '../provider-process/provider-spawned-process-identity'
import { supportsSupervisedProviderChildLocation } from '../provider-process/supervised-provider-child-location'
import { buildDroidExecLaunch } from './droid-exec-launch'
import { prepareDroidPrompt } from './droid-prompt'
import { DroidSession, type DroidConnection, type DroidSessionDeps } from './droid-session'
import { droidProviderLink, type DroidResolvedLaunch } from './droid-structured-launch-resolution'

export type DroidSessionAdapterDeps = DroidSessionDeps & {
  resolveLaunch: (
    identity: StructuredAgentSessionAcquireInput['identity']
  ) => Promise<DroidResolvedLaunch>
  readProcessStartTime?: (pid: number) => Promise<number | null>
}

export class DroidSessionAdapter implements StructuredAgentSessionAdapter {
  private readonly sessions = new Map<string, DroidSession>()
  private readonly acquiring = new Set<string>()
  private readonly starts = new ProviderAcquisitionStarts<DroidConnection>()
  private readonly retiring = new Set<Promise<void>>()
  constructor(private readonly deps: DroidSessionAdapterDeps) {}

  supportsLocation = supportsSupervisedProviderChildLocation
  supportsCreate: NonNullable<StructuredAgentSessionAdapter['supportsCreate']> = (
    location,
    agent
  ) => agent === 'droid' && this.supportsLocation(location)

  async acquire(input: StructuredAgentSessionAcquireInput): Promise<AgentSessionAcquisition> {
    const id = input.identity.sessionId
    if (this.acquiring.has(id)) {
      throw new AgentSessionPreSpawnError(new Error('Droid session already owns a child'))
    }
    this.acquiring.add(id)
    const attempt = this.starts.begin(input.signal)
    let session: DroidSession | undefined
    try {
      if (attempt.signal.aborted) {
        throw new AgentSessionPreSpawnError(new Error('Droid closed while starting'))
      }
      if (!(await this.starts.stopFailed(id))) {
        throw new AgentSessionAcquisitionExitUnprovenError(
          new Error('Previous Droid start has not exited')
        )
      }
      const previous = this.sessions.get(id)
      if (previous?.connection.closed && previous.connection.rootVerdict === 'exited') {
        this.acknowledgeSessionRelease(id)
      } else if (previous) {
        throw new AgentSessionPreSpawnError(new Error('Droid session already owns a child'))
      }
      let launch: DroidResolvedLaunch
      try {
        launch = await waitForPromiseWithSignal(
          this.deps.resolveLaunch(input.identity),
          attempt.signal
        )
      } catch (error) {
        throw new AgentSessionPreSpawnError(error)
      }
      if (attempt.signal.aborted) {
        throw new AgentSessionPreSpawnError(new Error('Droid closed while starting'))
      }
      const spec = buildDroidExecLaunch({
        command: launch.command,
        cwd: launch.cwd,
        env: launch.env,
        structuredSession: { id, spawnToken: input.spawnToken }
      })
      session = new DroidSession(input, randomUUID(), spec, this.deps, {
        cwd: launch.cwd,
        resumeId: launch.previous?.handle.nativeId ?? null
      })
      this.sessions.set(id, session)
      this.starts.track(attempt, session.connection)
      const spawned = providerSpawnedProcessIdentity(
        input,
        'Droid exec',
        this.deps.readProcessStartTime
      )
      if (session.connection.pid !== undefined) {
        await spawned.onSpawned(session.connection.pid)
      }
      const process = await spawned.read(session.connection.pid)
      const droidSessionId = await waitForPromiseWithSignal(session.start(), attempt.signal)
      if (session.connection.closed || attempt.signal.aborted) {
        throw new Error('Droid exited while starting')
      }
      return {
        process,
        acquisitionGeneration: session.generation,
        link: droidProviderLink(launch, droidSessionId, input.fence, randomUUID(), Date.now())
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
        // The release refusal must stay a refusal: it is how the person learns to update.
        if (isAgentSessionPreSpawnError(error)) {
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

  dispatch: StructuredAgentSessionAdapter['dispatch'] = async (input) => {
    const session = this.session(input.sessionId, input.fence)
    const prompt = prepareDroidPrompt(input.body)
    if (!prompt.ok) {
      return {
        state: 'rejected',
        ...agentSessionFailureWords(prompt.failure, { agentName: 'Droid', surface: 'rejection' })
      }
    }
    return session.turns.submit(
      input.clientMessageId,
      input.requestedAt ?? Date.now(),
      prompt.params,
      input.beforeDispatch
    )
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
    await session.connection.request('droid.interrupt_session', {}, { timeoutMs: 2_000 })
    return { cancelled: true, ...(turnId ? { turnId } : {}) }
  }
  stopEndsSession(): boolean {
    return true
  }

  // No Droid prompt reaches the journal yet, so there is nothing for a person to answer or pick.
  answerPrompt: StructuredAgentSessionAdapter['answerPrompt'] = async () => {
    throw new AgentSessionPromptAnswerRejectedError('Droid has no prompt waiting for an answer')
  }
  setOption: StructuredAgentSessionAdapter['setOption'] = async () => {
    throw new AgentSessionOptionRejectedError(new Error('Droid has no options to set'))
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
      throw new AgentSessionAcquisitionRootExitObservedError(new Error('Droid root exit observed'))
    }
    return true
  }
  releaseAcquisition(input: { sessionId: string }): Promise<boolean> {
    return this.closeSession(input.sessionId)
  }
  forceCloseSession(id: string): Promise<boolean> {
    this.sessions.get(id)?.fail(new Error('Droid event sink failed'))
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
  private session(id: string, fence: number): DroidSession {
    const session = this.sessions.get(id)
    if (!session || session.input.fence !== fence || session.connection.closed) {
      throw new Error('Droid session is not live under this fence')
    }
    return session
  }
}
