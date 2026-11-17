import {
  AcpRpcError,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_METHOD_NOT_FOUND
} from '../transport/acp-errors'
import type { AcpRequestContext } from '../transport/acp-json-rpc-peer'
import { answerAcpPermission, readAcpPermissionRequest } from './acp-permission-requests'
import type { AcpSessionRuntimeOptions } from './acp-session-runtime-options'

export function handleAcpSessionClientRequest(
  method: string,
  params: unknown,
  context: AcpRequestContext,
  options: AcpSessionRuntimeOptions,
  sessionId: string | undefined,
  diagnose: (message: string) => void
): unknown {
  if (method !== 'session/request_permission') {
    if (!options.onRequest) {
      throw new AcpRpcError(JSON_RPC_METHOD_NOT_FOUND, `Unknown ACP client method: ${method}`)
    }
    return options.onRequest(method, params, context)
  }
  const request = readAcpPermissionRequest(params, diagnose)
  if (!request) {
    throw new AcpRpcError(JSON_RPC_INVALID_PARAMS, 'Invalid ACP permission request')
  }
  // Only the started session asks the caller; the caller decides who can answer.
  if (request.sessionId !== sessionId) {
    return { outcome: { outcome: 'cancelled' } }
  }
  return answerAcpPermission(request, context, options.onPermission, diagnose)
}
