import type { NdjsonRejectedRecord } from '../../shared/main-process-ndjson-framer'
import {
  AcpAgentError,
  AcpConnectionClosedError,
  AcpInvalidResponseError,
  AcpRequestTimeoutError,
  AcpRpcError
} from './acp-errors'
import { settleOversizedAcpLine, type AcpOversizedLineTarget } from './acp-oversized-lines'
import {
  acpRpcEnvelopeSchema,
  type AcpInboundFrame,
  type AcpJsonRpcMessage
} from './acp-rpc-envelope'

/** How a JSON-RPC peer over stdio speaks one protocol: ids, extra frame fields, and what it reports. */
export type AcpPeerDialect = {
  /** Names the protocol in diagnostics and limit errors. */
  label: string
  /** The id of the nth request the peer sends. */
  requestId: (sequence: number) => string | number
  /** A frame as written. Key order is wire order. */
  stamp: (message: AcpJsonRpcMessage) => unknown
  /** An inbound record as a frame, or undefined when it is not one. May note fields the frame drops. */
  read: (record: unknown) => AcpInboundFrame | undefined
  errors: {
    closed: (message?: string) => Error
    timeout: (method: string) => Error
    /** The other side answered a request with an error. */
    remote: (code: number, message: string, data: unknown) => Error
    /** An answer that cannot be read, or says both or neither of result and error. */
    invalidResponse: (message: string, raw: unknown) => Error
  }
  /** How a request is turned away when too many are already open. */
  overCapacity: () => AcpRpcError
  /** What a line over the size limit costs: its sender, its caller, or the connection. */
  onOversizedLine: (
    rejected: NdjsonRejectedRecord & { kind: 'line-too-long' },
    target: AcpOversizedLineTarget
  ) => void
}

export const acpPeerDialect: AcpPeerDialect = {
  label: 'ACP',
  requestId: (sequence) => sequence,
  stamp: (message) => message,
  read: (record) => {
    const parsed = acpRpcEnvelopeSchema.safeParse(record)
    return parsed.success ? parsed.data : undefined
  },
  errors: {
    closed: (message) => new AcpConnectionClosedError(message),
    timeout: (method) => new AcpRequestTimeoutError(method),
    remote: (code, message, data) => new AcpAgentError(code, message, data),
    invalidResponse: (message, raw) => new AcpInvalidResponseError(message, raw)
  },
  overCapacity: () => new AcpRpcError(-32603, 'ACP incoming request capacity exceeded'),
  onOversizedLine: settleOversizedAcpLine
}
