import { AGENT_SESSION_HOST_COMMAND_CAPABILITY } from '../../../../shared/agent-session/agent-session-host-command'
import {
  mcpSignInCallerFor,
  STRUCTURED_AGENT_SESSION_MCP_SIGN_IN_METHODS
} from './structured-agent-session-mcp-sign-in'
export { mcpSignInCallerFor } from './structured-agent-session-mcp-sign-in'
import { agentSessionRefusalError } from '../../../../shared/agent-session/failures/agent-session-wire-refusals'
import {
  CopyConversationParams,
  HostCommandParams
} from '../../../../shared/rpc-contract/structured-agent-session-host-command-params'
import { defineMethod, type RpcContext } from '../core'
import {
  requireInstalledStructuredHost,
  structuredCallerFor
} from './structured-agent-session-gate'

type CommandClient = Pick<RpcContext, 'clientKind' | 'clientCapabilities'>

export function clientRunsHostCommands(ctx: CommandClient): boolean {
  return (
    ctx.clientKind === undefined ||
    ctx.clientCapabilities?.includes(AGENT_SESSION_HOST_COMMAND_CAPABILITY) === true
  )
}

export function projectHostCommandCatalog<T>(value: T, ctx: CommandClient): T {
  if (clientRunsHostCommands(ctx) || typeof value !== 'object' || value === null) {
    return value
  }
  if ('page' in value && value.page !== null && typeof value.page === 'object') {
    return { ...value, page: projectHostCommandCatalog(value.page, ctx) }
  }
  if ('value' in value && value.value !== null && typeof value.value === 'object') {
    return { ...value, value: projectHostCommandCatalog(value.value, ctx) }
  }
  if (!('commands' in value) || !Array.isArray(value.commands)) {
    return value
  }
  return {
    ...value,
    commands: value.commands.filter(
      (entry: unknown) =>
        !entry || typeof entry !== 'object' || !('hostCommand' in entry) || !entry.hostCommand
    )
  }
}

export const STRUCTURED_AGENT_SESSION_HOST_COMMAND_METHODS = [
  ...STRUCTURED_AGENT_SESSION_MCP_SIGN_IN_METHODS,
  defineMethod({
    name: 'agentSession.copyConversation',
    permission: 'workspace',
    params: CopyConversationParams,
    handler: async (params, ctx) => {
      if (!clientRunsHostCommands(ctx)) {
        throw agentSessionRefusalError('structured_agent_session_unsupported', {
          reason: 'clientCapabilityMissing'
        })
      }
      return (
        await requireInstalledStructuredHost(ctx, params.envelope.sessionId)
      ).copyConversation(structuredCallerFor(ctx), params)
    }
  }),
  defineMethod({
    name: 'agentSession.hostCommand',
    permission: 'workspace',
    params: HostCommandParams,
    handler: async (params, ctx) => {
      if (!clientRunsHostCommands(ctx)) {
        throw agentSessionRefusalError('structured_agent_session_unsupported', {
          reason: 'clientCapabilityMissing'
        })
      }
      return (await requireInstalledStructuredHost(ctx, params.envelope.sessionId)).hostCommand(
        {
          ...structuredCallerFor(ctx),
          mcpSignInCaller: mcpSignInCallerFor(ctx),
          localMcpSignIn: ctx.connectionId === undefined && ctx.caller?.kind !== 'paired-device'
        },
        params
      )
    }
  })
]
