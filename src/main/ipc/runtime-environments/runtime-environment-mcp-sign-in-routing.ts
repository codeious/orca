import type { KnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type { RetainedRemoteRuntimeSubscription } from './runtime-environment-subscription-handlers'
import { runtimeEnvironmentRevisionFailure } from './runtime-environment-revision-guard'

type McpSignInRequest = {
  method: string
  params?: unknown
  timeoutMs?: number
  expectedEnvironmentPairingRevision?: number
  expectedEnvironmentRuntimeId?: string
}

export function forwardMcpSignInRequest(
  environment: KnownRuntimeEnvironment,
  subscriptions: ReadonlyMap<string, RetainedRemoteRuntimeSubscription>,
  ownerWebContentsId: number,
  args: McpSignInRequest
): RuntimeRpcResponse<unknown> | Promise<RuntimeRpcResponse<unknown>> | undefined {
  const sessionId = mcpSignInSessionId(args.method, args.params)
  if (!sessionId) {
    return undefined
  }
  const failure = runtimeEnvironmentRevisionFailure(
    environment,
    args.expectedEnvironmentPairingRevision,
    args.method,
    args.expectedEnvironmentRuntimeId
  )
  if (failure) {
    return failure
  }
  const stream = [...subscriptions.values()].find(
    (subscription) =>
      subscription.environmentId === environment.id &&
      subscription.ownerWebContentsId === ownerWebContentsId &&
      subscription.mcpSignInSessionId === sessionId &&
      subscription.sendRequest !== undefined
  )
  return (
    stream?.sendRequest?.(args.method, args.params, args.timeoutMs ?? 195_000) ?? {
      id: args.method,
      ok: false,
      error: {
        code: 'mcp_sign_in_client_unavailable',
        message: 'Open this chat on this client before signing in.'
      },
      _meta: { runtimeId: environment.runtimeId }
    }
  )
}
function mcpSignInSessionId(method: string, params: unknown): string | undefined {
  if (
    method !== 'agentSession.hostCommand' ||
    typeof params !== 'object' ||
    params === null ||
    !('envelope' in params) ||
    typeof params.envelope !== 'object' ||
    params.envelope === null ||
    !('sessionId' in params.envelope) ||
    typeof params.envelope.sessionId !== 'string' ||
    !('name' in params) ||
    params.name !== 'mcp' ||
    !('argument' in params) ||
    typeof params.argument !== 'string' ||
    !/^sign-in(?:\s|$)/.test(params.argument.trim())
  ) {
    return undefined
  }
  return params.envelope.sessionId
}
