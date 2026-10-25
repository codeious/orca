import type { Readable, Writable } from 'node:stream'
import {
  createIncrementalNdjsonFramer,
  encodeNdjson
} from '../../shared/main-process-ndjson-framer'
import { requestTimeout, resolveAcpPeerOptions, type AcpPeerOptions } from '../acp/acp-peer-limits'
import { detachProviderStreamErrorHandler } from '../provider-process/provider-stdio-error-boundary'
import { ProviderStdioWriteQueue } from '../provider-process/provider-stdio-write-queue'
import {
  droidInboundFrameSchema,
  stampDroidFrame,
  type DroidOutgoingFrame
} from './droid-rpc-envelope'
import {
  DroidConnectionClosedError,
  DroidRequestTimeoutError,
  DroidRpcError
} from './droid-rpc-errors'

export type DroidPeerOptions = AcpPeerOptions
export type DroidRequestContext = { id: string; signal: AbortSignal }
export type DroidPeerHandlers = {
  /** What a request from Droid (a permission, a question) is answered with. Unhandled methods
   *  throw `DroidRpcError(-32601)`; any other throw is answered as an internal error. */
  onRequest?: (method: string, params: unknown, context: DroidRequestContext) => unknown
  onNotification?: (method: string, params: unknown) => void
  onDiagnostic?: (message: string) => void
  onClose?: (error: Error) => void
}

type Pending = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

/** Droid's JSON-RPC 2.0 over newline-delimited stdio: string ids and a stamp on every frame sent. */
export class DroidJsonRpcPeer {
  private readonly pending = new Map<string, Pending>()
  private readonly incoming = new Map<string, AbortController>()
  private readonly writer: ProviderStdioWriteQueue
  private readonly framer: ReturnType<typeof createIncrementalNdjsonFramer>
  private readonly limits: Required<DroidPeerOptions>
  private nextId = 1
  private terminalError?: Error

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly handlers: DroidPeerHandlers = {},
    options: DroidPeerOptions = {}
  ) {
    this.limits = resolveAcpPeerOptions(options)
    this.writer = new ProviderStdioWriteQueue(
      output,
      this.limits.maxQueuedWriteBytes,
      (error) => this.close(error),
      {
        capacity: () => new Error('Droid write queue capacity exceeded'),
        closed: () => new DroidConnectionClosedError('Droid input is not writable')
      }
    )
    this.framer = createIncrementalNdjsonFramer(
      (record) => this.dispatch(record),
      (rejected) =>
        rejected.kind === 'line-too-long'
          ? this.close(new Error('Droid sent a line over the size limit'))
          : this.diagnose(`Ignored Droid line: ${rejected.kind}`),
      { maxLineBytes: this.limits.maxLineBytes }
    )
    input.setEncoding('utf8')
    input.on('data', this.onData)
    input.on('end', this.onInputEnd)
    input.on('close', this.onInputEnd)
    input.on('error', this.onError)
    output.on('close', this.onEnd)
    output.on('finish', this.onEnd)
    output.on('error', this.onError)
    if (
      (this.limits.closeOnInputEnd && (input.destroyed || input.readableEnded)) ||
      output.destroyed ||
      !output.writable
    ) {
      this.onEnd()
    }
  }

  get closed(): boolean {
    return this.terminalError !== undefined
  }

  /** The `factoryProtocolVersion` on the newest frame Droid stamped one on. */
  protocolVersion: string | undefined

  request(
    method: string,
    params: unknown,
    options: { timeoutMs?: number | null; onId?: (id: string) => void } = {}
  ): Promise<unknown> {
    if (this.terminalError) {
      return Promise.reject(this.terminalError)
    }
    if (this.pending.size >= this.limits.maxPendingRequests) {
      return Promise.reject(new Error('Droid pending request capacity exceeded'))
    }
    let timeoutMs: number | null
    try {
      timeoutMs = requestTimeout(
        options.timeoutMs === undefined ? this.limits.requestTimeoutMs : options.timeoutMs
      )
    } catch (error) {
      return Promise.reject(error)
    }
    const id = `orca-${this.nextId++}`
    const controller = new AbortController()
    // Droid echoes the id on the notification that admits the message, possibly before the reply.
    options.onId?.(id)
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === null
          ? undefined
          : setTimeout(() => {
              this.pending.delete(id)
              const error = new DroidRequestTimeoutError(method)
              controller.abort(error)
              reject(error)
            }, timeoutMs)
      this.pending.set(id, { method, resolve, reject, timer })
      void this.send({ type: 'request', id, method, params }, controller.signal).catch((error) => {
        const pending = this.pending.get(id)
        if (pending) {
          this.pending.delete(id)
          clearTimeout(timer)
          pending.reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    })
  }

  close(error: Error = new DroidConnectionClosedError()): void {
    if (this.terminalError) {
      return
    }
    this.input.removeListener('data', this.onData)
    this.input.removeListener('end', this.onInputEnd)
    this.input.removeListener('close', this.onInputEnd)
    this.output.removeListener('close', this.onEnd)
    this.output.removeListener('finish', this.onEnd)
    this.framer.reset()
    detachProviderStreamErrorHandler(this.input, this.onError)
    detachProviderStreamErrorHandler(this.output, this.onError)
    this.terminalError = error
    this.writer.close(error)
    for (const controller of this.incoming.values()) {
      controller.abort(error)
    }
    this.incoming.clear()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    try {
      this.handlers.onClose?.(error)
    } catch (failure) {
      this.diagnose(String(failure))
    }
  }

  private readonly onData = (chunk: string): void => {
    try {
      this.framer.feed(chunk)
    } catch (error) {
      this.close(error instanceof Error ? error : new Error(String(error)))
    }
  }
  private readonly onEnd = (): void => this.close()
  // A process owner reports an exit itself; stdout ending first is not proof of one.
  private readonly onInputEnd = (): void => {
    if (this.limits.closeOnInputEnd) {
      this.close()
    }
  }
  private readonly onError = (error: Error): void => this.close(error)

  private diagnose(message: string): void {
    try {
      this.handlers.onDiagnostic?.(message)
    } catch {
      /* Diagnostics cannot break the transport. */
    }
  }

  private send(frame: DroidOutgoingFrame, signal?: AbortSignal): Promise<void> {
    if (this.terminalError) {
      return Promise.reject(this.terminalError)
    }
    try {
      return this.writer.write(
        encodeNdjson(stampDroidFrame(frame), this.limits.maxLineBytes),
        signal
      )
    } catch (error) {
      return Promise.reject(error)
    }
  }

  private notify(method: string, params: unknown): void {
    try {
      this.handlers.onNotification?.(method, params)
    } catch (error) {
      this.diagnose(`Droid notification handler failed: ${String(error)}`)
    }
  }

  /** Every request gets an answer, or Droid waits on it for good. */
  private answerRequest(id: string, method: string, params: unknown): void {
    if (this.incoming.size >= this.limits.maxIncomingRequests) {
      void this.send({
        type: 'response',
        id,
        error: { code: -32000, message: 'Too many open requests' }
      }).catch(() => undefined)
      return
    }
    const controller = new AbortController()
    this.incoming.set(id, controller)
    const { onRequest } = this.handlers
    void new Promise<unknown>((resolve, reject) => {
      if (!onRequest) {
        reject(new DroidRpcError(-32601, 'Method not found'))
        return
      }
      resolve(onRequest(method, params, { id, signal: controller.signal }))
    })
      .then(
        (result): DroidOutgoingFrame => ({ type: 'response', id, result: result ?? null }),
        (error): DroidOutgoingFrame => ({
          type: 'response',
          id,
          error:
            error instanceof DroidRpcError
              ? { code: error.code, message: error.message }
              : { code: -32603, message: 'Internal error' }
        })
      )
      .then((frame) => {
        this.incoming.delete(id)
        return this.send(frame)
      })
      .catch(() => undefined)
  }

  private dispatch(record: unknown): void {
    if (this.closed) {
      return
    }
    const parsed = droidInboundFrameSchema.safeParse(record)
    if (!parsed.success) {
      this.diagnose('Ignored invalid Droid frame')
      return
    }
    const frame = parsed.data
    if (typeof frame.factoryProtocolVersion === 'string') {
      this.protocolVersion = frame.factoryProtocolVersion
    }
    if (frame.method !== undefined) {
      if ('result' in frame || 'error' in frame) {
        this.diagnose('Ignored invalid Droid request')
      } else if (frame.id !== undefined) {
        this.answerRequest(frame.id, frame.method, frame.params)
      } else {
        this.notify(frame.method, frame.params)
      }
      return
    }
    const pending = frame.id === undefined ? undefined : this.pending.get(frame.id)
    if (frame.id === undefined || !pending) {
      return
    }
    this.pending.delete(frame.id)
    clearTimeout(pending.timer)
    if ('result' in frame === 'error' in frame) {
      this.diagnose('Ignored invalid Droid response')
      pending.reject(new Error('Droid sent an invalid response'))
    } else if (frame.error) {
      pending.reject(new DroidRpcError(frame.error.code, frame.error.message, frame.error.data))
    } else {
      pending.resolve(frame.result)
    }
  }
}
