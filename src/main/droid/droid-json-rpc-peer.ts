import type { Readable, Writable } from 'node:stream'
import {
  AcpRpcError,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_SERVER_BUSY
} from '../acp/acp-errors'
import { AcpJsonRpcPeer, type AcpPeerDialect, type AcpPeerOptions } from '../acp/acp-json-rpc-peer'
import { droidInboundFrameSchema, stampDroidFrame } from './droid-rpc-envelope'
import {
  DroidConnectionClosedError,
  DroidRequestTimeoutError,
  DroidRpcError
} from './droid-rpc-errors'

export type DroidPeerOptions = AcpPeerOptions
export type DroidRequestContext = { id: string; signal: AbortSignal }
export type DroidPeerHandlers = {
  /** What a request from Droid (a permission, a question) is answered with. Unhandled methods
   *  throw `DroidRpcError(JSON_RPC_METHOD_NOT_FOUND)`; any other throw is answered as an internal error. */
  onRequest?: (method: string, params: unknown, context: DroidRequestContext) => unknown
  onNotification?: (method: string, params: unknown) => void
  onDiagnostic?: (message: string) => void
  onClose?: (error: Error) => void
}

function droidDialect(noteProtocolVersion: (version: string) => void): AcpPeerDialect {
  return {
    label: 'Droid',
    requestId: (sequence) => `orca-${sequence}`,
    stamp: (message) =>
      stampDroidFrame({ type: message.method === undefined ? 'response' : 'request', ...message }),
    read: (record) => {
      const parsed = droidInboundFrameSchema.safeParse(record)
      if (!parsed.success) {
        return undefined
      }
      if (typeof parsed.data.factoryProtocolVersion === 'string') {
        noteProtocolVersion(parsed.data.factoryProtocolVersion)
      }
      return parsed.data
    },
    errors: {
      closed: (message) => new DroidConnectionClosedError(message),
      timeout: (method) => new DroidRequestTimeoutError(method),
      remote: (code, message, data) => new DroidRpcError(code, message, data),
      invalidResponse: () => new Error('Droid sent an invalid response')
    },
    overCapacity: () => new AcpRpcError(JSON_RPC_SERVER_BUSY, 'Too many open requests'),
    // A notification right behind a permission request in one chunk can already be about it.
    startRequestsSynchronously: true,
    // The lost frame may be the reply a turn waits on, and nothing else would ever settle it.
    onOversizedLine: (_rejected, target) =>
      target.close(new Error('Droid sent a line over the size limit'))
  }
}

/** Droid's JSON-RPC 2.0 over newline-delimited stdio: the ACP peer, with string ids and a stamp on every frame sent. */
export class DroidJsonRpcPeer {
  private readonly peer: AcpJsonRpcPeer

  /** The `factoryProtocolVersion` on the newest frame Droid stamped one on. */
  protocolVersion: string | undefined

  constructor(
    input: Readable,
    output: Writable,
    handlers: DroidPeerHandlers = {},
    options: DroidPeerOptions = {}
  ) {
    this.peer = new AcpJsonRpcPeer(
      input,
      output,
      {
        onRequest: async (method, params, { id, signal }) => {
          try {
            if (typeof id !== 'string' || !handlers.onRequest) {
              throw new DroidRpcError(JSON_RPC_METHOD_NOT_FOUND, 'Method not found')
            }
            return await handlers.onRequest(method, params, { id, signal })
          } catch (error) {
            // A thrown message can name a path or a secret, and Droid shows what it is told.
            throw error instanceof DroidRpcError
              ? new AcpRpcError(error.code, error.message)
              : new AcpRpcError(JSON_RPC_INTERNAL_ERROR, 'Internal error')
          }
        },
        onNotification: (method, params) => handlers.onNotification?.(method, params),
        onDiagnostic: (message) => handlers.onDiagnostic?.(message),
        onClose: (error) => handlers.onClose?.(error)
      },
      options,
      droidDialect((version) => {
        this.protocolVersion = version
      })
    )
  }

  get closed(): boolean {
    return this.peer.closed
  }

  request(
    method: string,
    params: unknown,
    options: { timeoutMs?: number | null; onId?: (id: string) => void } = {}
  ): Promise<unknown> {
    const { onId } = options
    return this.peer.request(method, params, {
      timeoutMs: options.timeoutMs,
      onId: (id) => {
        if (typeof id === 'string') {
          onId?.(id)
        }
      }
    })
  }

  close(error?: Error): void {
    this.peer.close(error)
  }
}
