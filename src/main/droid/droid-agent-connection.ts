import { spawnProcess } from '@orca/process-host'
import type { ProviderProcessSpawner } from '../provider-process/provider-process-spawn'
import {
  providerDiagnostic,
  withProviderDiagnostic
} from '../../shared/agent-session/failures/agent-session-failure'
import {
  spawnManagedProviderProcess,
  type ManagedProviderProcess,
  type ProviderProcessExit
} from '../provider-process/managed-provider-process'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import { withLostProviderOutcome } from '../provider-process/provider-process-exit-status'
import { awaitProviderChildSpawn } from '../provider-process/provider-child'
import {
  afterProviderOutputDrains,
  PROVIDER_EXIT_OUTPUT_DRAIN_MS
} from '../provider-process/provider-exit-output-drain'
import type { ProviderProcessCloseResult } from '../provider-process/provider-process-close'
import { PROVIDER_STDIN_END_GRACE_MAX_MS } from '../provider-process/provider-process-supervisor'
import {
  withProviderSpawnAbsence,
  type ProviderSpawnAbsence
} from '../provider-process/provider-executable-missing'
import { resolveAcpPeerOptions } from '../acp/transport/acp-peer-limits'
import {
  DroidJsonRpcPeer,
  type DroidPeerHandlers,
  type DroidPeerOptions
} from './droid-json-rpc-peer'
import { DROID_PEER_LIMITS } from './droid-peer-limits'
import { DroidConnectionClosedError } from './droid-rpc-errors'

/** droid 0.249.0 exits 0 about 1.2–1.7s after stdin EOF, past the default stdin-end grace. */
const DROID_STDIN_END_GRACE_MS = PROVIDER_STDIN_END_GRACE_MAX_MS

export type DroidAgentConnectionOptions = DroidPeerHandlers & {
  peer?: Omit<DroidPeerOptions, 'closeOnInputEnd'>
  /** Process exit evidence, including expected closes and processless spawn failures. */
  onExit?: (error: Error, context: { expected: boolean; exit: ProviderProcessExit }) => void
  /** Any stdout or stderr chunk from the child. */
  onOutput?: () => void
}

/** The execution host owns the `droid exec` process; this keeps its exit evidence apart from the
 *  state of the JSON-RPC stream, and the session above owns turns and Stop. */
export class DroidAgentConnection {
  private readonly managed: ManagedProviderProcess
  private readonly peer: DroidJsonRpcPeer
  private closing = false
  private inputEnded = false
  private inputEndTimer?: ReturnType<typeof setTimeout>
  private finishObservedExit?: () => void

  constructor(
    launch: ProviderProcessLaunch,
    private readonly options: DroidAgentConnectionOptions = {},
    spawnImpl: ProviderProcessSpawner = spawnProcess
  ) {
    // Rejected before the spawn so a bad limit cannot leave a process nobody owns.
    const peerOptions = resolveAcpPeerOptions({
      ...DROID_PEER_LIMITS,
      ...options.peer,
      closeOnInputEnd: false
    })
    this.managed = spawnManagedProviderProcess(launch, {
      spawnImpl,
      site: 'droid-agent-teardown',
      stdinEndGraceMs: DROID_STDIN_END_GRACE_MS,
      ...(options.onOutput ? { onOutput: options.onOutput } : {})
    })
    const { child } = this.managed
    this.peer = new DroidJsonRpcPeer(
      child.stdout,
      child.stdin,
      { ...options, onClose: (error) => this.onPeerClose(error) },
      peerOptions
    )
    child.stdout.once('end', this.onInputEnd)
    child.stdout.once('close', this.onInputEnd)
    child.on('error', this.onError)
    child.stderr.on('error', this.onError)
    this.managed.onExit((exit) => this.onRootExit(exit))
  }

  get pid(): number | undefined {
    return this.managed.child.pid
  }
  /** Settles once `pid` names the running Droid, or its launch failed and it stays unset. */
  get spawned(): Promise<void> {
    return awaitProviderChildSpawn(this.managed.child)
  }
  get closed(): boolean {
    return this.peer.closed
  }
  get rootVerdict(): ManagedProviderProcess['rootVerdict'] {
    return this.managed.rootVerdict
  }
  get processless(): boolean {
    return this.managed.processless
  }
  /** What a spawn ENOENT proved absent: the Droid CLI or its launch folder. */
  get spawnAbsence(): ProviderSpawnAbsence | null {
    return this.managed.spawnAbsence
  }
  get lastCloseResult(): ManagedProviderProcess['lastCloseResult'] {
    return this.managed.lastCloseResult
  }
  get protocolVersion(): string | undefined {
    return this.peer.protocolVersion
  }

  stderrTail(): string {
    return this.managed.stderrTail().trim()
  }

  onExit(listener: () => void): void {
    this.managed.onExit(listener)
  }

  request(
    method: string,
    params: unknown = {},
    options: { timeoutMs?: number | null; onId?: (id: string) => void } = {}
  ): Promise<unknown> {
    return this.peer.request(method, params, options)
  }

  pauseReading(): void {
    this.managed.child.stdout.pause()
  }

  resumeReading(): void {
    this.managed.child.stdout.resume()
  }

  close(error?: Error): Promise<ProviderProcessCloseResult> {
    this.closing = true
    clearTimeout(this.inputEndTimer)
    this.finishObservedExit?.()
    this.peer.close(error)
    return this.managed.close()
  }

  private onPeerClose(error: Error): void {
    if (this.closing || this.managed.rootVerdict === 'exited') {
      return
    }
    void this.managed.close().then(
      (result) => {
        if (result.root !== 'exited') {
          this.diagnose('Droid exit was not proven after a stream failure')
        }
      },
      () => this.diagnose('Droid cleanup failed after a stream failure')
    )
    this.options.onClose?.(error)
  }

  // Output often ends just before the exit that says how Droid ended; without one, nothing answers.
  private readonly onInputEnd = (): void => {
    if (this.inputEnded) {
      return
    }
    this.inputEnded = true
    if (this.closing || this.managed.rootVerdict === 'exited') {
      return
    }
    this.inputEndTimer = setTimeout(
      () => this.peer.close(new DroidConnectionClosedError('Droid closed its output')),
      PROVIDER_EXIT_OUTPUT_DRAIN_MS
    )
    this.inputEndTimer.unref()
  }

  private readonly onError = (error: Error): void =>
    this.peer.close(withProviderSpawnAbsence(error, this.managed.spawnAbsence))

  private onRootExit(exit: ProviderProcessExit): void {
    clearTimeout(this.inputEndTimer)
    const { managed } = this
    const error = withProviderSpawnAbsence(
      withProviderDiagnostic(
        new DroidConnectionClosedError(
          exit.processless
            ? 'Droid process could not start'
            : `Droid process exited (code ${exit.code ?? 'none'}, signal ${exit.signal ?? 'none'})`
        ),
        providerDiagnostic(managed.stderrTail(), 'person')
      ),
      managed.spawnAbsence
    )
    withLostProviderOutcome(error, exit)
    const finish = (): void => {
      this.finishObservedExit = undefined
      this.peer.close(error)
      managed.child.removeListener('error', this.onError)
      try {
        this.options.onExit?.(error, { expected: this.closing, exit })
      } catch {
        this.diagnose('Droid exit observer failed')
      }
    }
    if (this.closing || exit.processless || this.peer.closed || this.inputEnded) {
      finish()
    } else {
      // The last frames before an exit are the ones that settle a turn, and a descendant can hold stdout.
      this.finishObservedExit = afterProviderOutputDrains(
        managed.child.stdout,
        finish,
        managed.child
      )
    }
  }

  private diagnose(message: string): void {
    try {
      this.options.onDiagnostic?.(message)
    } catch {
      /* Diagnostics cannot break cleanup. */
    }
  }
}
