import { z } from 'zod'
import {
  DROID_MCP_NAME_MAX_LENGTH,
  type DroidHostCommandResult,
  type DroidMcpAction,
  type DroidMcpChange,
  type DroidMcpServer
} from '../../shared/droid-host-command'
import { DroidMcpSignInStopped } from './droid-mcp-sign-in'
import { isDroidMethodNotFound } from './droid-missing-method'
import { DroidRequestTimeoutError, DroidRpcError } from './droid-rpc-errors'
import type { DroidSession } from './droid-session'

type McpSession = Pick<DroidSession, 'request' | 'mcpSignIn'>

// The browser step is the person's, so the wait is long; it ends well before the client's 195 s.
const SIGN_IN_TIMEOUT_MS = 150_000
const MAX_SERVERS_SHOWN = 200

// Droid's `error`, `pendingAuthUrl`, `pendingAuthMessage` and `pendingAuthState` are left unread: they
// can carry a sign-in link or a secret, and the card needs none of them.
const listedSchema = z.looseObject({
  servers: z.array(
    z.looseObject({
      name: z.string().min(1).max(DROID_MCP_NAME_MAX_LENGTH),
      status: z.string().max(40),
      serverType: z.string().optional(),
      toolCount: z.number().int().nonnegative().optional(),
      requiresAuth: z.boolean().optional(),
      hasAuthTokens: z.boolean().optional()
    })
  )
})
const verdictSchema = z.looseObject({ success: z.unknown() })

async function listServers(session: McpSession): Promise<DroidMcpServer[]> {
  const listed = listedSchema.safeParse(await session.request('droid.list_mcp_servers', {}))
  if (!listed.success) {
    throw new Error('Droid did not list its MCP servers. Try again.')
  }
  return listed.data.servers.map((server) => ({
    name: server.name,
    status: server.status,
    type:
      server.serverType === 'stdio' || server.serverType === 'http' || server.serverType === 'sse'
        ? server.serverType
        : null,
    toolCount: server.toolCount ?? null,
    needsSignIn: server.requiresAuth === true && server.hasAuthTokens !== true
  }))
}

/** Droid's answer to a change is `{ success: true }`; anything else is a refusal. */
function confirm(answer: unknown, refusal: string): void {
  if (verdictSchema.safeParse(answer).data?.success !== true) {
    throw new Error(refusal)
  }
}

async function signIn(
  session: McpSession,
  serverName: string,
  isStdio: boolean
): Promise<DroidMcpChange> {
  let answer: unknown
  try {
    answer = await session.mcpSignIn.run(serverName, () =>
      session.request(
        'droid.authenticate_mcp_server',
        { serverName },
        { timeoutMs: SIGN_IN_TIMEOUT_MS }
      )
    )
  } catch (error) {
    // Droid's own text is not repeated: on a sign-in it can hold the link.
    if (error instanceof DroidRequestTimeoutError) {
      throw new Error(
        `Sign-in to ${serverName} has not finished. Finish it in your browser, then run /mcp to check.`
      )
    }
    if (
      error instanceof DroidMcpSignInStopped ||
      !(error instanceof DroidRpcError) ||
      isDroidMethodNotFound(error)
    ) {
      throw error
    }
    throw new Error(
      isStdio
        ? `Droid could not sign in to ${serverName}. Sign-in works only for remote (HTTP or SSE) servers that ask for it.`
        : `Droid could not sign in to ${serverName}.`
    )
  }
  confirm(answer, `Droid did not sign in to ${serverName}.`)
  return { kind: 'signed-in', serverName }
}

async function change(
  session: McpSession,
  action: Exclude<DroidMcpAction, { kind: 'list' | 'sign-in' }>
): Promise<DroidMcpChange> {
  switch (action.kind) {
    case 'add': {
      const { serverName, server } = action
      const params =
        server.type === 'stdio'
          ? { name: serverName, type: 'stdio', command: server.command, args: server.args }
          : { name: serverName, type: server.type, url: server.url }
      confirm(
        await session.request('droid.add_mcp_server', params),
        `Droid did not add ${serverName}.`
      )
      return { kind: 'added', serverName }
    }
    case 'toggle': {
      const { serverName, enabled } = action
      confirm(
        await session.request('droid.toggle_mcp_server', {
          serverName,
          enabled,
          settingsLevel: 'user'
        }),
        `Droid did not turn ${serverName} ${enabled ? 'on' : 'off'}.`
      )
      return { kind: enabled ? 'enabled' : 'disabled', serverName }
    }
    case 'remove': {
      const { serverName } = action
      confirm(
        await session.request('droid.remove_mcp_server', { serverName, settingsLevel: 'user' }),
        `Droid did not remove ${serverName}.`
      )
      return { kind: 'removed', serverName }
    }
  }
}

/** A change Droid said it made, checked against what it lists next. */
function checkListed(servers: DroidMcpServer[], { kind, serverName }: DroidMcpChange): void {
  const now = servers.find((server) => server.name === serverName)
  if (kind === 'added' && !now) {
    throw new Error(`Droid did not add ${serverName}.`)
  }
  if (kind === 'removed' && now) {
    throw new Error(`Droid still lists ${serverName}.`)
  }
  // A setting at another level can keep a server as it was, so the new listing is what is believed.
  if (kind === 'disabled' && now && now.status !== 'disabled') {
    throw new Error(`Droid still lists ${serverName} as on.`)
  }
  if (kind === 'enabled' && now?.status === 'disabled') {
    throw new Error(`Droid still lists ${serverName} as off.`)
  }
}

/** Lists Droid's MCP servers; with a change, makes it at the user level first and lists again. */
export async function runDroidMcp(
  session: McpSession,
  action: DroidMcpAction
): Promise<DroidHostCommandResult> {
  const before = await listServers(session)
  if (action.kind === 'list') {
    return { name: 'mcp', servers: before.slice(0, MAX_SERVERS_SHOWN), changed: null }
  }
  const known = before.find((server) => server.name === action.serverName)
  if (action.kind === 'add' && known) {
    throw new Error(`Droid already has an MCP server named ${action.serverName}.`)
  }
  if (action.kind !== 'add' && !known) {
    throw new Error(`Droid has no MCP server named ${action.serverName}.`)
  }
  const changed =
    action.kind === 'sign-in'
      ? await signIn(session, action.serverName, known?.type === 'stdio')
      : await change(session, action)
  const servers = await listServers(session)
  checkListed(servers, changed)
  return { name: 'mcp', servers: servers.slice(0, MAX_SERVERS_SHOWN), changed }
}
