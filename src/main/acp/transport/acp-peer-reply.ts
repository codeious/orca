import type { AcpPeerDialect } from './acp-peer-dialect'
import type { AcpPendingResponse } from './acp-response-settlement'
import { acpInvalidResponseId, settleAcpResponse, type AcpInboundFrame } from './acp-rpc-envelope'

type RejectPending = (id: string | number, error: (method: string) => Error) => void
type ReplyDialect = Pick<AcpPeerDialect, 'label' | 'errors'>

function invalidEnvelope({ label, errors }: ReplyDialect, record: unknown): () => Error {
  return () => errors.invalidResponse(`Invalid ${label} response envelope`, record)
}

/** A record no envelope reads still fails the call its id names. */
export function rejectUnreadableAcpReply(
  record: unknown,
  rejectPending: RejectPending,
  dialect: ReplyDialect
): void {
  const id = acpInvalidResponseId(record)
  if (id !== undefined) {
    rejectPending(id, invalidEnvelope(dialect, record))
  }
}

/** Settles the outstanding call an agent's reply answers; a malformed reply fails its call. */
export function settleAcpReply(input: {
  record: unknown
  frame: AcpInboundFrame
  pending: Map<string | number, AcpPendingResponse>
  rejectPending: RejectPending
  diagnose: (message: string) => void
  dialect: ReplyDialect
}): void {
  const { frame, dialect } = input
  if ('result' in frame === 'error' in frame) {
    input.diagnose(`Ignored invalid ${dialect.label} response`)
    if (frame.id != null) {
      input.rejectPending(frame.id, invalidEnvelope(dialect, input.record))
    }
    return
  }
  const pending = frame.id == null ? undefined : input.pending.get(frame.id)
  if (!pending || frame.id == null) {
    return
  }
  input.pending.delete(frame.id)
  clearTimeout(pending.timer)
  settleAcpResponse(frame, pending, input.diagnose, dialect)
}
