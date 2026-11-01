import { randomUUID } from 'node:crypto'
import { DroidHostTextError } from '../../droid/droid-host-text'

export const MCP_SIGN_IN_OPEN_ACK_TIMEOUT_MS = 30_000

export type McpSignInOpenRequest = { requestId: string; url: string }
export type McpSignInCaller = { callerKey: string; connectionId: string }
type Endpoint = McpSignInCaller & {
  sessionId: string
  send: (request: McpSignInOpenRequest) => void
}
type Command = {
  serverName: string
  endpoint?: Endpoint
  opening?: Promise<boolean>
  request?: { id: string; finish: (opened: boolean) => void }
}

/** Only a live command's chosen reader can open its link; no link is retained or replayed. */
export class AgentSessionMcpSignInForwarding {
  private readonly endpoints = new Map<string, Endpoint>()
  private readonly commands = new Map<string, Command>()

  subscribe(id: string, endpoint: Endpoint): () => void {
    this.endpoints.set(id, endpoint)
    return () => {
      if (this.endpoints.get(id) === endpoint) {
        this.endpoints.delete(id)
      }
      for (const command of this.commands.values()) {
        if (command.endpoint === endpoint) {
          command.endpoint = undefined
          command.request?.finish(false)
        }
      }
    }
  }

  async run<T>(
    sessionId: string,
    caller: McpSignInCaller | undefined,
    serverName: string,
    run: () => Promise<T>
  ): Promise<T> {
    if (this.commands.has(sessionId)) {
      throw new DroidHostTextError('mcpSignInIncomplete', { serverName })
    }
    const endpoint = caller
      ? [...this.endpoints.values()].find(
          (reader) =>
            reader.sessionId === sessionId &&
            reader.callerKey === caller.callerKey &&
            reader.connectionId === caller.connectionId
        )
      : undefined
    const command: Command = { serverName, endpoint }
    this.commands.set(sessionId, command)
    try {
      const result = await run()
      // Authentication can reply before the browser; that is not an opened verdict.
      if (command.opening && !(await command.opening)) {
        throw new DroidHostTextError('mcpLinkNotOpened', { serverName })
      }
      return result
    } finally {
      command.request?.finish(false)
      if (this.commands.get(sessionId) === command) {
        this.commands.delete(sessionId)
      }
    }
  }

  open(sessionId: string, url: string, serverName: string): Promise<boolean> | boolean {
    const command = this.commands.get(sessionId)
    if (!command?.endpoint || command.serverName !== serverName) {
      return false
    }
    if (command.opening) {
      return command.opening
    }
    const endpoint = command.endpoint
    const requestId = randomUUID()
    let finish = (_opened: boolean) => {}
    const opening = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), MCP_SIGN_IN_OPEN_ACK_TIMEOUT_MS)
      finish = (opened) => {
        clearTimeout(timer)
        command.request = undefined
        resolve(opened)
      }
    })
    command.opening = opening
    command.request = { id: requestId, finish }
    try {
      endpoint.send({ requestId, url })
    } catch {
      finish(false)
    }
    return opening
  }

  acknowledge(
    sessionId: string,
    requestId: string,
    connectionId: string,
    callerKey: string,
    opened: boolean
  ): boolean {
    const command = this.commands.get(sessionId)
    if (
      !command?.request ||
      command.request.id !== requestId ||
      command.endpoint?.connectionId !== connectionId ||
      command.endpoint.callerKey !== callerKey
    ) {
      return false
    }
    command.request.finish(opened)
    return true
  }

  close(sessionId: string): void {
    const command = this.commands.get(sessionId)
    if (command) {
      command.endpoint = undefined
      command.request?.finish(false)
    }
  }
}
