import type { PipedProcessSpawner } from '@orca/process-host/process-spec'
import { spawnProcess } from '@orca/process-host'
import {
  spawnManagedProviderProcess,
  type ManagedProviderProcess,
  type ProviderProcessExit
} from '../provider-process/managed-provider-process'
import { PROVIDER_STDIN_END_GRACE_MAX_MS } from '../provider-process/provider-process-supervisor'
import { resolveAcpPeerOptions } from '../acp/acp-peer-limits'
import { withMissingProviderExecutable } from '../provider-process/provider-executable-missing'
import {
  rootOnlyProviderClosePolicy,
  type ProviderProcessCloseResult
} from '../provider-process/provider-process-close'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import {
  DroidJsonRpcPeer,
  type DroidPeerHandlers,
  type DroidPeerOptions
} from './droid-json-rpc-peer'
import { DROID_PEER_LIMITS } from './droid-peer-limits'
import { DroidConnectionClosedError } from './droid-rpc-errors'

/** droid 0.249.0 exits 0 about 1.2–1.7s after stdin EOF; the 1s default grace SIGKILLs it (137) first. */
export const DROID_STDIN_END_GRACE_MS = PROVIDER_STDIN_END_GRACE_MAX_MS

/** Unsupervised closes (Windows) wait out the same EOF window; a supervisor already budgets the max. */
export function droidProviderClosePolicy(
  supervised: boolean
): ReturnType<typeof rootOnlyProviderClosePolicy> {
  const policy = rootOnlyProviderClosePolicy(supervised)
  if (supervised || policy.gracefulExitMs >= DROID_STDIN_END_GRACE_MS) {
    return policy
  }
  return { ...policy, gracefulExitMs: DROID_STDIN_END_GRACE_MS }
}

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
  private finishObservedExit?: () => void
  private streamExitTimer?: ReturnType<typeof setTimeout>

  constructor(
    launch: ProviderProcessLaunch,
    private readonly options: DroidAgentConnectionOptions = {},
    spawnImpl: PipedProcessSpawner = spawnProcess
  ) {
    // Rejected before the spawn so a bad limit cannot leave a process nobody owns.
    const peerOptions = resolveAcpPeerOptions({
      ...DROID_PEER_LIMITS,
      ...options.peer,
      closeOnInputEnd: DROID_PEER_LIMITS.closeOnInputEnd
    })
    const managed = spawnManagedProviderProcess(launch, {
      spawnImpl,
      site: 'droid-agent-teardown',
      policy: droidProviderClosePolicy,
      stdinEndGraceMs: DROID_STDIN_END_GRACE_MS,
      ...(options.onOutput ? { onOutput: options.onOutput } : {})
    })
    this.managed = managed
    this.peer = new DroidJsonRpcPeer(
      managed.child.stdout,
      managed.child.stdin,
      {
        ...options,
        onClose: (error) => this.onPeerClose(error)
      },
      peerOptions
    )
    const { stdout } = managed.child
    // EOF without an exit leaves nothing to answer a request; the exit, if any, follows it closely.
    stdout.once('end', this.onStdoutEnd)
    managed.child.on('error', this.onError)
    managed.child.stderr.on('error', this.onError)
    managed.onExit((exit) => this.onRootExit(exit))
  }

  get pid(): number | undefined {
    return this.managed.child.pid
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
    clearTimeout(this.streamExitTimer)
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

  private readonly onStdoutEnd = (): void => {
    if (this.closing || this.managed.rootVerdict === 'exited') {
      return
    }
    this.streamExitTimer = setTimeout(
      () => this.peer.close(new DroidConnectionClosedError('Droid closed its output')),
      250
    )
    this.streamExitTimer.unref()
  }

  private readonly onError = (error: Error): void => this.peer.close(this.markIfNotInstalled(error))

  // Read where the spawn is observed: the wording of a start that fails depends on it.
  private markIfNotInstalled<TError extends Error>(error: TError): TError {
    return this.managed.executableMissing ? withMissingProviderExecutable(error) : error
  }

  private onRootExit(exit: ProviderProcessExit): void {
    clearTimeout(this.streamExitTimer)
    const { managed } = this
    const error = this.markIfNotInstalled(
      new DroidConnectionClosedError(
        exit.processless
          ? 'Droid process could not start'
          : `Droid process exited (code ${exit.code ?? 'none'}, signal ${exit.signal ?? 'none'})`
      )
    )
    const { stdout } = managed.child
    let finished = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      if (finished) {
        return
      }
      finished = true
      clearTimeout(timer)
      stdout.removeListener('end', finish)
      stdout.removeListener('close', finish)
      this.finishObservedExit = undefined
      this.peer.close(error)
      managed.child.removeListener('error', this.onError)
      try {
        this.options.onExit?.(error, { expected: this.closing, exit })
      } catch {
        this.diagnose('Droid exit observer failed')
      }
    }
    this.finishObservedExit = finish
    if (
      this.closing ||
      exit.processless ||
      this.peer.closed ||
      stdout.destroyed ||
      stdout.readableEnded
    ) {
      finish()
      return
    }
    // The last frames before an exit are the ones that settle a turn: read them out first.
    stdout.once('end', finish)
    stdout.once('close', finish)
    // A descendant can keep stdout open after the root is gone.
    timer = setTimeout(finish, 1_000)
    timer.unref()
  }

  private diagnose(message: string): void {
    try {
      this.options.onDiagnostic?.(message)
    } catch {
      /* Diagnostics cannot break cleanup. */
    }
  }
}
