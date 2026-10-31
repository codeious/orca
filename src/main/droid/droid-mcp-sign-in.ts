import { z } from 'zod'

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
  warn: (message: string, fields: { serverName: string }) => void
}

/** A sign-in that ended before Droid answered it; its words never carry Droid's text. */
export class DroidMcpSignInStopped extends Error {}

export class DroidMcpSignIn {
  private readonly waiting = new Set<Waiting>()
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
    // Registered before the request goes out: the challenge can arrive ahead of its answer.
    let stop: (error: Error) => void = () => {}
    const stopped = new Promise<never>((_resolve, reject) => {
      stop = reject
    })
    const entry: Waiting = { serverName, stop }
    this.waiting.add(entry)
    this.opened.delete(serverName)
    try {
      return await Promise.race([authenticate(), stopped])
    } finally {
      this.waiting.delete(entry)
      this.opened.delete(serverName)
    }
  }

  private openLink({ serverName, authUrl, state }: z.infer<typeof requiredSchema>): void {
    if (state !== undefined) {
      if (this.opened.get(serverName) === state) {
        return
      }
      this.opened.set(serverName, state)
    }
    const { open } = this.deps
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
        }
      })
  }

  private linkNotOpened(serverName: string): void {
    this.opened.delete(serverName)
    this.deps.warn('Droid asked to sign in to an MCP server and the link could not be opened', {
      serverName
    })
    this.stopWaiting(
      serverName,
      `Orca could not open the sign-in link for ${serverName} on this host.`
    )
  }

  private finish({ serverName, outcome }: z.infer<typeof completedSchema>): void {
    this.opened.delete(serverName)
    if (outcome === 'cancelled') {
      this.stopWaiting(serverName, `Sign-in to ${serverName} was cancelled.`)
    } else if (outcome !== 'success') {
      this.stopWaiting(serverName, `Sign-in to ${serverName} did not finish.`)
    }
  }

  private stopWaiting(serverName: string, sentence: string): void {
    for (const entry of this.waiting) {
      if (entry.serverName === serverName) {
        entry.stop(new DroidMcpSignInStopped(sentence))
      }
    }
  }
}
