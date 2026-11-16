import { z } from 'zod'
import {
  agentSessionMcpWebUrl,
  type AgentSessionMcpOperation,
  type AgentSessionMcpResult,
  type AgentSessionMcpServer,
  type AgentSessionMcpServerStatus,
  type AgentSessionMcpSignIn
} from '../../shared/agent-session/agent-session-mcp'
import {
  matchingMcpSignInCallback,
  readMcpSignInRedirectUri
} from '../native-chat/agent-session-wire/operations/structured-agent-session-mcp-callback'
import { DroidServiceCommandError } from './droid-service-command-error'
import { isDroidMethodNotFound } from './droid-missing-method'
import { DroidRpcError } from './droid-rpc-errors'
import type { DroidSession } from './droid-session'

type McpSession = Pick<DroidSession, 'request' | 'mcpSignIn' | 'connection'>

// The person's browser step; Droid's own request ends with it.
const SIGN_IN_WINDOW_MS = 300_000
const MAX_SERVERS_SHOWN = 200
const STATUSES: Readonly<Record<string, AgentSessionMcpServerStatus>> = {
  connected: 'connected',
  connecting: 'pending',
  disabled: 'disabled'
}

// Droid's `error`, `pendingAuthUrl`, `pendingAuthMessage` and `pendingAuthState` are left unread: they
// can carry a sign-in link or a secret.
const listedSchema = z.looseObject({
  servers: z.array(
    z.looseObject({
      name: z.string().min(1).max(200),
      status: z.string().max(40),
      source: z.string().max(40).optional(),
      serverType: z.string().optional(),
      toolCount: z.number().int().nonnegative().optional(),
      requiresAuth: z.boolean().optional(),
      hasAuthTokens: z.boolean().optional()
    })
  )
})
const verdictSchema = z.looseObject({ success: z.unknown() })

async function listServers(session: McpSession): Promise<AgentSessionMcpServer[]> {
  const listed = listedSchema.safeParse(await session.request('droid.list_mcp_servers', {}))
  if (!listed.success) {
    throw new DroidServiceCommandError('mcpUnreadable')
  }
  return listed.data.servers.slice(0, MAX_SERVERS_SHOWN).map((server) => {
    const status = STATUSES[server.status] ?? 'failed'
    const signedOut = server.requiresAuth === true && server.hasAuthTokens !== true
    return {
      name: server.name,
      status: signedOut && status !== 'connected' && status !== 'disabled' ? 'needs-auth' : status,
      source: server.source ?? null,
      toolCount: status === 'connected' ? (server.toolCount ?? null) : null,
      error: null,
      // Droid authenticates only remote servers, and a disabled one must be enabled first.
      canSignIn: server.serverType !== 'stdio' && status !== 'disabled',
      // Droid has no reconnect; it reconnects a server itself once its sign-in or setting changes.
      canReconnect: false,
      canToggle: true
    }
  })
}

async function listed(
  session: McpSession,
  name: string
): Promise<{ server: AgentSessionMcpServer; servers: AgentSessionMcpServer[] }> {
  const servers = await listServers(session)
  const server = servers.find((row) => row.name === name)
  if (!server) {
    throw new DroidServiceCommandError('mcpUnknown')
  }
  return { server, servers }
}

/** Droid's answer to a change is `{ success: true }`; anything else is a refusal. */
function confirm(answer: unknown, refusal: DroidServiceCommandError): void {
  if (verdictSchema.safeParse(answer).data?.success !== true) {
    throw refusal
  }
}

async function signIn(
  session: McpSession,
  serverName: string
): Promise<AgentSessionMcpSignIn | undefined> {
  if (!(await listed(session, serverName)).server.canSignIn) {
    throw new DroidServiceCommandError('mcpSignInStdio')
  }
  const url = await session.mcpSignIn.start(serverName, () =>
    session
      .request('droid.authenticate_mcp_server', { serverName }, { timeoutMs: SIGN_IN_WINDOW_MS })
      .then(
        (answer) => confirm(answer, new DroidServiceCommandError('mcpSignInRefused')),
        (error: unknown) => {
          throw error instanceof DroidRpcError && !isDroidMethodNotFound(error)
            ? new DroidServiceCommandError('mcpSignInFailed')
            : error
        }
      )
  )
  const page = url && agentSessionMcpWebUrl(url)
  if (!page) {
    return undefined
  }
  const redirect = readMcpSignInRedirectUri(page)
  // Only a loopback redirect can be handed back from a browser on another device.
  const callback = redirect !== null && matchingMcpSignInCallback(redirect, redirect) !== null
  return { server: serverName, url: page, finish: callback ? 'callback' : 'external' }
}

async function toggle(
  session: McpSession,
  serverName: string,
  enabled: boolean
): Promise<AgentSessionMcpServer[]> {
  await listed(session, serverName)
  confirm(
    await session.request('droid.toggle_mcp_server', {
      serverName,
      enabled,
      settingsLevel: 'user'
    }),
    new DroidServiceCommandError(enabled ? 'mcpNotOn' : 'mcpNotOff')
  )
  // A setting at another level can keep a server as it was, so the new listing is what is believed.
  const now = await listed(session, serverName)
  if ((now.server.status === 'disabled') === enabled) {
    throw new DroidServiceCommandError(enabled ? 'mcpStillOff' : 'mcpStillOn')
  }
  return now.servers
}

type McpRun = { servers?: AgentSessionMcpServer[]; signIn?: AgentSessionMcpSignIn }

async function run(session: McpSession, operation: AgentSessionMcpOperation): Promise<McpRun> {
  switch (operation.action) {
    case 'status':
      return {}
    case 'signIn':
      return { signIn: await signIn(session, operation.server) }
    case 'finishSignIn':
      await session.mcpSignIn.finish(operation.server, operation.callbackUrl)
      return {}
    case 'reconnect':
      throw new DroidServiceCommandError('mcpNoReconnect')
    case 'toggle':
      return { servers: await toggle(session, operation.server, operation.enabled) }
  }
}

/** The `/mcp` panel on a running Droid child; at rest Droid has no process to ask. */
export async function manageDroidMcp(
  sessions: ReadonlyMap<string, McpSession>,
  sessionId: string,
  operation: AgentSessionMcpOperation
): Promise<AgentSessionMcpResult> {
  const session = sessions.get(sessionId)
  const live = (): boolean => sessions.get(sessionId) === session && !session?.connection.closed
  if (!session || !live()) {
    return { status: 'not-running' }
  }
  try {
    const { signIn, ...done } = await run(session, operation)
    const servers = done.servers ?? (await listServers(session))
    if (!live()) {
      return { status: 'not-running' }
    }
    return signIn ? { status: 'ok', servers, signIn } : { status: 'ok', servers }
  } catch (error) {
    if (!live()) {
      return { status: 'not-running' }
    }
    if (isDroidMethodNotFound(error)) {
      return { status: 'unsupported' }
    }
    // Droid's own text can repeat a sign-in link.
    throw error instanceof DroidServiceCommandError
      ? error
      : new Error('Droid could not complete this MCP action.')
  }
}
