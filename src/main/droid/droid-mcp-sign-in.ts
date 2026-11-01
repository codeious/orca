import { z } from 'zod'
import type { DroidHostCopyKey } from '../../shared/droid-host-copy'
import { DroidHostTextError, droidHostText } from './droid-host-text'
import type { DroidSessionDeps } from './droid-session'
import type { JsonlRpcTimelineLane } from '../jsonl-rpc/timeline-lane'

export function createDroidSessionMcpSignIn(
  deps: Pick<DroidSessionDeps, 'openMcpSignIn' | 'forwardMcpSignIn' | 'logger'>,
  sessionId: string,
  lane: Pick<JsonlRpcTimelineLane, 'apply'>
): DroidMcpSignIn {
  return new DroidMcpSignIn({
    open: deps.openMcpSignIn,
    forward: deps.forwardMcpSignIn
      ? (serverName, url) => deps.forwardMcpSignIn?.(sessionId, url, serverName) ?? false
      : undefined,
    ...(!deps.openMcpSignIn && deps.forwardMcpSignIn
      ? {
          opened: (serverName: string) =>
            lane.apply([
              {
                type: 'item.update',
                item: `mcp-opened:${Date.now()}`,
                body: { kind: 'status', ...droidHostText('mcpLinkOpened', { serverName }) }
              }
            ])
        }
      : {}),
    warn: (message, fields) =>
      deps.logger.warn(message, { scope: 'droid-mcp', sessionId, ...fields })
  })
}

// The sign-in link goes to the opener and no further: it is never stored, logged, journaled or
// answered, and Droid's `message` (which may repeat it) is never read.

const requiredSchema = z.looseObject({
  type: z.literal('mcp_auth_required'),
  serverName: z.string().min(1),
  authUrl: z.string().min(1),
  state: z.string().optional()
})
const completedSchema = z.looseObject({
  type: z.literal('mcp_auth_completed'),
  serverName: z.string().min(1),
  outcome: z.string()
})
const envelopeSchema = z.looseObject({ notification: z.unknown() })

/** Opens the link on the machine Orca runs on; false when it could not. */
export type DroidMcpSignInOpener = (url: string) => boolean | Promise<boolean>

type Waiting = { serverName: string; stop: (error: Error) => void }

type DroidMcpSignInDeps = {
  open?: DroidMcpSignInOpener
  forward?: (serverName: string, url: string) => boolean | Promise<boolean>
  opened?: (serverName: string) => void
  warn: (message: string, fields: { serverName: string }) => void
}

/** A sign-in that ended before Droid answered it; its words never carry Droid's text. */
export class DroidMcpSignInStopped extends DroidHostTextError {}

export class DroidMcpSignIn {
  private readonly waiting = new Set<Waiting>()
  // Browser fallback is not remote cancellation; untagged challenges must not reach a later caller.
  private readonly forwardingAttempts = new Map<string, object>()
  /** The state last opened per server, so a repeat opens no second tab; forgotten when a sign-in starts or ends. */
  private readonly opened = new Map<string, string>()

  constructor(private readonly deps: DroidMcpSignInDeps) {}

  /** `droid.session_notification` params. A challenge or outcome that cannot be read is ignored. */
  receive(params: unknown): void {
    const notification = envelopeSchema.safeParse(params).data?.notification
    const required = requiredSchema.safeParse(notification)
    if (required.success) {
      this.openLink(required.data)
      return
    }
    const completed = completedSchema.safeParse(notification)
    if (completed.success) {
      this.finish(completed.data)
    }
  }

  /** Runs a sign-in request, ending it early when the link cannot be opened or Droid reports it stopped. */
  async run<T>(serverName: string, authenticate: () => Promise<T>): Promise<T> {
    const forwarded = !this.deps.open && this.deps.forward !== undefined
    if (forwarded && this.forwardingAttempts.has(serverName)) {
      throw new DroidMcpSignInStopped('mcpSignInIncomplete', { serverName })
    }
    const attempt = {}
    if (forwarded) {
      this.forwardingAttempts.set(serverName, attempt)
    }
    // Registered before the request goes out: the challenge can arrive ahead of its answer.
    let stop: (error: Error) => void = () => {}
    const stopped = new Promise<never>((_resolve, reject) => {
      stop = reject
    })
    const entry: Waiting = { serverName, stop }
    this.waiting.add(entry)
    this.opened.delete(serverName)
    try {
      const authenticated = authenticate().then((answer) => {
        if (this.forwardingAttempts.get(serverName) === attempt) {
          this.forwardingAttempts.delete(serverName)
        }
        return answer
      })
      return await Promise.race([authenticated, stopped])
    } finally {
      this.waiting.delete(entry)
      this.opened.delete(serverName)
    }
  }

  private openLink({ serverName, authUrl, state }: z.infer<typeof requiredSchema>): void {
    if (
      !this.deps.open &&
      this.deps.forward &&
      ![...this.waiting].some((entry) => entry.serverName === serverName)
    ) {
      return
    }
    if (state !== undefined) {
      if (this.opened.get(serverName) === state) {
        return
      }
      this.opened.set(serverName, state)
    }
    const open =
      this.deps.open ??
      (this.deps.forward
        ? (url: string) => this.deps.forward?.(serverName, url) ?? false
        : undefined)
    if (!open) {
      this.linkNotOpened(serverName)
      return
    }
    let opening: Promise<boolean>
    try {
      opening = Promise.resolve(open(authUrl))
    } catch {
      opening = Promise.resolve(false)
    }
    void opening
      .catch(() => false)
      .then((opened) => {
        if (!opened) {
          this.linkNotOpened(serverName)
        } else {
          this.deps.opened?.(serverName)
        }
      })
  }

  private linkNotOpened(serverName: string): void {
    this.opened.delete(serverName)
    this.deps.warn('Droid asked to sign in to an MCP server and the link could not be opened', {
      serverName
    })
    this.stopWaiting(serverName, 'mcpLinkNotOpened')
  }

  private finish({ serverName, outcome }: z.infer<typeof completedSchema>): void {
    this.forwardingAttempts.delete(serverName)
    this.opened.delete(serverName)
    if (outcome === 'cancelled') {
      this.stopWaiting(serverName, 'mcpSignInCancelled')
    } else if (outcome !== 'success') {
      this.stopWaiting(serverName, 'mcpSignInIncomplete')
    }
  }

  private stopWaiting(serverName: string, key: DroidHostCopyKey): void {
    for (const entry of this.waiting) {
      if (entry.serverName === serverName) {
        entry.stop(new DroidMcpSignInStopped(key, { serverName }))
      }
    }
  }
}
