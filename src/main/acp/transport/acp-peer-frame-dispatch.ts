import type { AcpPendingResponse } from './acp-response-settlement'
import type { AcpPeerDialect } from './acp-peer-dialect'
import { rejectUnreadableAcpReply, settleAcpReply } from './acp-peer-reply'
import type { AcpIncomingRequests } from './acp-incoming-requests'
import type { AcpPeerHandlers } from './acp-peer-handlers'

export function dispatchAcpPeerFrame(
  record: unknown,
  {
    dialect,
    diagnose,
    rejectPending,
    drainingNotifications,
    pending,
    incoming,
    handlers
  }: {
    dialect: AcpPeerDialect
    diagnose: (message: string) => void
    rejectPending: (id: string | number, error: (method: string) => Error) => void
    drainingNotifications: boolean
    pending: Map<string | number, AcpPendingResponse>
    incoming: AcpIncomingRequests
    handlers: AcpPeerHandlers
  }
): boolean {
  const { label } = dialect
  const frame = dialect.read(record)
  if (!frame) {
    diagnose(`Ignored invalid ${label} JSON-RPC envelope`)
    rejectUnreadableAcpReply(record, rejectPending, dialect)
    return false
  }
  if (drainingNotifications && (frame.id !== undefined || frame.method === undefined)) {
    return false
  }
  if (frame.method !== undefined) {
    if ('result' in frame || 'error' in frame) {
      diagnose(`Ignored invalid ${label} request`)
      return false
    }
    if (frame.id !== undefined) {
      incoming.handle(frame.id, frame.method, frame.params)
      return false
    }
    if (frame.method === '$/cancel_request') {
      incoming.cancelRequested(frame.params)
      return false
    }
    try {
      handlers.onNotification?.(frame.method, frame.params)
    } catch (error) {
      diagnose(`${label} notification handler failed: ${String(error)}`)
    }
    return false
  }
  settleAcpReply({
    record,
    frame,
    pending,
    rejectPending,
    diagnose,
    dialect
  })
  return true
}
