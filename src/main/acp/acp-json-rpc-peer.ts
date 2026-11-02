import type { Readable, Writable } from 'node:stream'
import { readAcpResponse } from './acp-response-settlement'
import type { AcpResponse, AcpRequestOptions, AcpPendingResponse } from './acp-response-settlement'
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
import { settleAcpResponse, acpInvalidResponseId, type AcpJsonRpcMessage } from './acp-rpc-envelope'
export type { AcpJsonRpcMessage } from './acp-rpc-envelope'
import type { AcpPeerHandlers } from './acp-peer-handlers'
export type { AcpPeerHandlers, AcpRequestContext } from './acp-peer-handlers'
export class AcpJsonRpcPeer {
  private readonly pending = new Map<string | number, AcpPendingResponse>()
  private readonly incoming: AcpIncomingRequests
  private readonly writer: ProviderStdioWriteQueue
  private readonly framer: ReturnType<typeof createIncrementalNdjsonFramer>
  private nextId = 1
  private terminalError?: Error
  private drainingNotifications = false
  private readonly limits: Required<AcpPeerOptions>

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly handlers: AcpPeerHandlers = {},
    options: AcpPeerOptions = {},
    private readonly dialect: AcpPeerDialect = acpPeerDialect
  ) {
    const limits = resolveAcpPeerOptions(options)
    this.limits = limits
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
      this.limits.maxIncomingRequests,
      (message) => this.diagnose(message),
      dialect
    )
    this.framer = createIncrementalNdjsonFramer(
      (record) => this.dispatch(record),
      (rejected) => {
        if (rejected.kind === 'line-too-long') {
          this.handlers.onOtherLine?.(rejected.prefix, true)
          dialect.onOversizedLine(rejected, {
            rejectPending: (id, error) => this.rejectPending(id, error),
            refuse: (id, error) => this.incoming.refuse(id, error),
            close: (error) => this.close(error),
            diagnose: (message) => this.diagnose(message)
          })
        } else {
          this.otherLine(rejected.line)
        }
      },
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

  request<T>(method: string, params: unknown, options: AcpRequestOptions<T>): Promise<T>
  request(
    method: string,
    params: unknown,
    options?: { timeoutMs?: number | null; onId?: (id: string | number) => void }
  ): Promise<unknown>
  request(
    method: string,
    params: unknown,
    options: Partial<AcpRequestOptions> = {}
  ): Promise<unknown> {
    if (this.terminalError) {
      return Promise.reject(this.terminalError)
    }
    if (this.pending.size >= this.limits.maxPendingRequests) {
      return Promise.reject(new Error(`${this.dialect.label} pending request capacity exceeded`))
    }
    let timeoutMs: number | null
    try {
      timeoutMs = requestTimeout(
        options.timeoutMs === undefined ? this.limits.requestTimeoutMs : options.timeoutMs
      )
    } catch (error) {
      return Promise.reject(error)
    }
    const id = this.dialect.requestId(this.nextId++)
    const controller = new AbortController()
    // An echo of the id can reach the caller before the reply does.
    options.onId?.(id)
    return new Promise((resolve, reject) => {
      const settle = (response: AcpResponse): void => {
        try {
          resolve(readAcpResponse(response, options.settle))
        } catch (error) {
          reject(error)
        }
      }
      const timer =
        timeoutMs === null
          ? undefined
          : setTimeout(() => {
              this.pending.delete(id)
              const error = this.dialect.errors.timeout(method, timeoutMs)
              controller.abort(error)
              reject(error)
            }, timeoutMs)
      this.pending.set(id, {
        method,
        resolve: (value) => settle({ value }),
        reject: (error) => settle({ error }),
        timer
      })
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

  /** Aborts signals; handlers still own replies. */
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
    const tail = this.framer.takeTail()
    if (tail.trim()) {
      this.otherLine(tail)
    }
    if (this.limits.closeOnInputEnd) {
      this.close()
    }
  }
  private readonly onError = (error: Error): void => this.close(error)
  private otherLine(line: string): void {
    this.handlers.onOtherLine?.(line)
    this.diagnose(`Ignored ${this.dialect.label} line: invalid-json`)
  }
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
      return this.writer.write(
        encodeNdjson(this.dialect.stamp(message), this.limits.maxLineBytes),
        signal
      )
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
      const responseId = acpInvalidResponseId(record)
      if (responseId !== undefined) {
        this.rejectPending(responseId, invalidEnvelope)
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
