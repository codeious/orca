import type { Readable, Writable } from 'node:stream'
import { z } from 'zod'
import {
  createIncrementalNdjsonFramer,
  encodeNdjson
} from '../../shared/main-process-ndjson-framer'
import { AcpIncomingRequests } from './acp-incoming-requests'
import { requestTimeout, resolveAcpPeerOptions, type AcpPeerOptions } from './acp-peer-limits'
export type { AcpPeerOptions } from './acp-peer-limits'
import { acpPeerDialect, type AcpPeerDialect } from './acp-peer-dialect'
export type { AcpPeerDialect } from './acp-peer-dialect'
import { ProviderStdioWriteQueue } from '../provider-process/provider-stdio-write-queue'
import { detachAcpStreamErrorHandler } from './acp-stdio-error-boundary'
import { settleAcpResponse, type AcpJsonRpcMessage } from './acp-rpc-envelope'
export type { AcpJsonRpcMessage } from './acp-rpc-envelope'
export type AcpRequestContext = { id: string | number | null; signal: AbortSignal }
export type AcpPeerHandlers = {
  // Void means handled; unsupported methods must throw AcpRpcError(-32601). The handler owns its
  // request: once the signal aborts it still answers, or throws (-32800); unanswered ends at close().
  onRequest?: (method: string, params: unknown, context: AcpRequestContext) => unknown
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

export class AcpJsonRpcPeer {
  private readonly pending = new Map<string | number, Pending>()
  private readonly incoming: AcpIncomingRequests
  private readonly writer: ProviderStdioWriteQueue
  private readonly framer: ReturnType<typeof createIncrementalNdjsonFramer>
  private nextId = 1
  private terminalError?: Error
  private drainingNotifications = false
  private readonly maxLineBytes: number
  private readonly maxPending: number
  private readonly maxIncoming: number
  private readonly timeoutMs: number | null
  private readonly closeOnInputEnd: boolean

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly handlers: AcpPeerHandlers = {},
    options: AcpPeerOptions = {},
    private readonly dialect: AcpPeerDialect = acpPeerDialect
  ) {
    const limits = resolveAcpPeerOptions(options)
    this.maxLineBytes = limits.maxLineBytes
    this.maxPending = limits.maxPendingRequests
    this.maxIncoming = limits.maxIncomingRequests
    this.timeoutMs = limits.requestTimeoutMs
    this.closeOnInputEnd = limits.closeOnInputEnd
    this.writer = new ProviderStdioWriteQueue(
      output,
      limits.maxQueuedWriteBytes,
      (error) => this.close(error),
      {
        capacity: () => new Error(`${dialect.label} write queue capacity exceeded`),
        closed: () => dialect.errors.closed(`${dialect.label} output is not writable`)
      }
    )
    this.incoming = new AcpIncomingRequests(
      handlers.onRequest,
      (message) => this.send(message),
      (error) => this.close(error),
      this.maxIncoming,
      (message) => this.diagnose(message),
      dialect
    )
    this.framer = createIncrementalNdjsonFramer(
      (record) => this.dispatch(record),
      (rejected) =>
        rejected.kind === 'line-too-long'
          ? dialect.onOversizedLine(rejected, {
              rejectPending: (id, error) => this.rejectPending(id, error),
              refuse: (id, error) => this.incoming.refuse(id, error),
              close: (error) => this.close(error),
              diagnose: (message) => this.diagnose(message)
            })
          : this.diagnose(`Ignored ${dialect.label} line: ${rejected.kind}`),
      { maxLineBytes: this.maxLineBytes }
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
      (this.closeOnInputEnd && (input.destroyed || input.readableEnded)) ||
      output.destroyed ||
      !output.writable
    ) {
      this.onEnd()
    }
  }

  get closed(): boolean {
    return this.terminalError !== undefined
  }

  request(
    method: string,
    params: unknown,
    options: { timeoutMs?: number | null; onId?: (id: string | number) => void } = {}
  ): Promise<unknown> {
    if (this.terminalError) {
      return Promise.reject(this.terminalError)
    }
    if (this.pending.size >= this.maxPending) {
      return Promise.reject(new Error(`${this.dialect.label} pending request capacity exceeded`))
    }
    let timeoutMs: number | null
    try {
      timeoutMs = requestTimeout(
        options.timeoutMs === undefined ? this.timeoutMs : options.timeoutMs
      )
    } catch (error) {
      return Promise.reject(error)
    }
    const id = this.dialect.requestId(this.nextId++)
    const controller = new AbortController()
    // An echo of the id can reach the caller before the reply does.
    options.onId?.(id)
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === null
          ? undefined
          : setTimeout(() => {
              this.pending.delete(id)
              const error = this.dialect.errors.timeout(method)
              controller.abort(error)
              reject(error)
            }, timeoutMs)
      this.pending.set(id, { method, resolve, reject, timer })
      void this.send({ jsonrpc: '2.0', id, method, params }, controller.signal).catch((error) => {
        const pending = this.pending.get(id)
        if (!pending) {
          return
        }
        this.pending.delete(id)
        clearTimeout(timer)
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  notify(method: string, params: unknown): Promise<void> {
    return this.send({ jsonrpc: '2.0', method, params })
  }

  /** Aborts every open agent request's signal; each handler still sends its own answer. */
  cancelIncomingRequests(): void {
    this.incoming.cancel()
  }

  close(error: Error = this.dialect.errors.closed()): void {
    this.shutdown(error, false)
  }

  /** Reject calls immediately; the process owner bounds how long final notifications can arrive. */
  drainNotifications(error: Error = this.dialect.errors.closed()): void {
    this.shutdown(error, true)
  }

  private shutdown(error: Error, drainNotifications: boolean): void {
    if (this.terminalError && (!this.drainingNotifications || drainNotifications)) {
      return
    }
    this.drainingNotifications = drainNotifications
    if (!drainNotifications) {
      this.input.removeListener('data', this.onData)
      this.input.removeListener('end', this.onInputEnd)
      this.input.removeListener('close', this.onInputEnd)
      detachAcpStreamErrorHandler(this.input, this.onError)
      this.framer.reset()
    }
    if (this.terminalError) {
      return
    }
    this.output.removeListener('close', this.onEnd)
    this.output.removeListener('finish', this.onEnd)
    detachAcpStreamErrorHandler(this.output, this.onError)
    this.terminalError = error
    this.writer.close(error)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.incoming.close(error)
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
  private readonly onInputEnd = (): void => {
    if (this.closeOnInputEnd) {
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

  private send(message: AcpJsonRpcMessage, signal?: AbortSignal): Promise<void> {
    if (this.terminalError) {
      return Promise.reject(this.terminalError)
    }
    try {
      return this.writer.write(encodeNdjson(this.dialect.stamp(message), this.maxLineBytes), signal)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  private rejectPending(id: string | number, error: (method: string) => Error): void {
    const pending = this.pending.get(id)
    if (pending) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.reject(error(pending.method))
    }
  }

  private dispatch(record: unknown): void {
    if (this.closed && !this.drainingNotifications) {
      return
    }
    const { label, errors } = this.dialect
    const invalidEnvelope = () =>
      errors.invalidResponse(`Invalid ${label} response envelope`, record)
    const frame = this.dialect.read(record)
    if (!frame) {
      this.diagnose(`Ignored invalid ${label} JSON-RPC envelope`)
      const response = z
        .object({
          id: z.union([z.string(), z.number()]),
          method: z.undefined().optional()
        })
        .safeParse(record)
      if (response.success) {
        this.rejectPending(response.data.id, invalidEnvelope)
      }
      return
    }
    if (this.drainingNotifications && (frame.id !== undefined || frame.method === undefined)) {
      return
    }
    if (frame.method !== undefined) {
      if ('result' in frame || 'error' in frame) {
        this.diagnose(`Ignored invalid ${label} request`)
        return
      }
      if (frame.id !== undefined) {
        this.incoming.handle(frame.id, frame.method, frame.params)
        return
      }
      try {
        this.handlers.onNotification?.(frame.method, frame.params)
      } catch (error) {
        this.diagnose(`${label} notification handler failed: ${String(error)}`)
      }
      return
    }
    if ('result' in frame === 'error' in frame) {
      this.diagnose(`Ignored invalid ${label} response`)
      if (frame.id != null) {
        this.rejectPending(frame.id, invalidEnvelope)
      }
      return
    }
    if (frame.id == null) {
      return
    }
    const pending = this.pending.get(frame.id)
    if (!pending) {
      return
    }
    this.pending.delete(frame.id)
    clearTimeout(pending.timer)
    settleAcpResponse(frame, pending, (message) => this.diagnose(message), this.dialect)
  }
}
