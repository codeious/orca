import { AGENT_SESSION_MCP_SIGN_IN_OPEN_CLIENT_CAPABILITY } from '../../../../shared/agent-session-mcp-sign-in-capability'
import type { McpSignInCaller } from '../../../native-chat/agent-session-wire/agent-session-mcp-sign-in-forwarding'
import { defineMethod, type RpcContext } from '../core'
import {
  requireInstalledStructuredHost,
  requireStructuredCapability,
  structuredCallerFor
} from './structured-agent-session-gate'
import { McpSignInOpenedParams } from '../../../../shared/rpc-contract/structured-agent-session-mcp-sign-in-params'

export function mcpSignInCallerFor(ctx: RpcContext): McpSignInCaller | undefined {
  if (
    ctx.clientKind === 'mobile' ||
    !ctx.connectionId ||
    !ctx.clientCapabilities?.includes(AGENT_SESSION_MCP_SIGN_IN_OPEN_CLIENT_CAPABILITY)
  ) {
    return undefined
  }
  return { connectionId: ctx.connectionId, callerKey: structuredCallerFor(ctx).callerKey }
}

export const STRUCTURED_AGENT_SESSION_MCP_SIGN_IN_METHODS = [
  defineMethod({
    name: 'agentSession.mcpSignInOpened',
    permission: 'workspace',
    params: McpSignInOpenedParams,
    handler: async (params, ctx) => {
      requireStructuredCapability(ctx)
      const caller = mcpSignInCallerFor(ctx)
      if (!caller) {
        return { accepted: false }
      }
      const host = await requireInstalledStructuredHost(ctx, params.sessionId)
      return {
        accepted: host.mcpSignIn.acknowledge(
          params.sessionId,
          params.requestId,
          caller.connectionId,
          caller.callerKey,
          params.opened
        )
      }
    }
  })
]
