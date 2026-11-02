import type { RemoteRuntimeSubscription } from '../../shared/remote-runtime/remote-runtime-client'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import { openMcpSignInOnThisMachine } from '../startup/mcp-sign-in-opener'

const MAX_SIGN_IN_REQUESTS = 64
const ACK_TIMEOUT_MS = 5_000

/** Consumes transient browser requests before a remote chat frame can reach renderer or recorder. */
export function createRuntimeEnvironmentMcpSignInReceiver(
  params: unknown,
  isCurrent: () => boolean,
  signal?: AbortSignal
) {
  const sessionId =
    typeof params === 'object' && params !== null && 'sessionId' in params
      ? params.sessionId
      : undefined
  const seen = new Set<string>()
  const pending = new Map<string, boolean>()
  let subscription: RemoteRuntimeSubscription | undefined
  let closed = false

  const close = (): void => {
    closed = true
    pending.clear()
    seen.clear()
    subscription = undefined
    signal?.removeEventListener('abort', close)
  }
  signal?.addEventListener('abort', close, { once: true })
  const active = (): boolean => !closed && !signal?.aborted && isCurrent()

  const acknowledge = (requestId: string, opened: boolean): void => {
    if (!active()) {
      return
    }
    if (!subscription) {
      pending.set(requestId, opened)
      return
    }
    // Discard transport errors: they may echo sensitive request data.
    try {
      void subscription
        .sendRequest?.(
          'agentSession.mcpSignInOpened',
          { sessionId, requestId, opened },
          ACK_TIMEOUT_MS
        )
        .catch(() => {})
    } catch {}
  }

  return {
    close,
    receive(response: RuntimeRpcResponse<unknown>): RuntimeRpcResponse<unknown> {
      if (!response.ok) {
        return response
      }
      const result = response.result
      if (
        typeof result !== 'object' ||
        result === null ||
        !('type' in result) ||
        result.type !== 'batch' ||
        !('mcpSignInOpen' in result)
      ) {
        return response
      }
      const { mcpSignInOpen, ...safeResult } = result
      const safeResponse = { ...response, result: safeResult }
      if (
        !active() ||
        typeof sessionId !== 'string' ||
        !('sessionId' in result) ||
        result.sessionId !== sessionId ||
        typeof mcpSignInOpen !== 'object' ||
        mcpSignInOpen === null ||
        !('requestId' in mcpSignInOpen) ||
        typeof mcpSignInOpen.requestId !== 'string' ||
        mcpSignInOpen.requestId.length === 0 ||
        mcpSignInOpen.requestId.length > 256 ||
        !('url' in mcpSignInOpen) ||
        typeof mcpSignInOpen.url !== 'string'
      ) {
        return safeResponse
      }
      const requestId = mcpSignInOpen.requestId
      // Fail closed at the bound rather than evicting IDs and reopening a replayed link.
      if (seen.has(requestId) || seen.size >= MAX_SIGN_IN_REQUESTS) {
        return safeResponse
      }
      seen.add(requestId)
      void openMcpSignInOnThisMachine(mcpSignInOpen.url).then(
        (opened) => acknowledge(requestId, opened),
        () => acknowledge(requestId, false)
      )
      return safeResponse
    },
    bind(stream: RemoteRuntimeSubscription): RemoteRuntimeSubscription {
      subscription = stream
      for (const [requestId, opened] of pending) {
        acknowledge(requestId, opened)
      }
      pending.clear()
      return {
        ...stream,
        close: () => {
          close()
          stream.close()
        }
      }
    }
  }
}
