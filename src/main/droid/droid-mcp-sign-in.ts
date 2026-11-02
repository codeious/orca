import { z } from 'zod'
import { DroidServiceCommandError, type DroidServiceErrorKey } from './droid-service-command-error'

const required = z.looseObject({
  type: z.literal('mcp_auth_required'),
  serverName: z.string().min(1).max(200),
  authUrl: z.string().min(1),
  state: z.string().optional()
})
const completed = z.looseObject({
  type: z.literal('mcp_auth_completed'),
  serverName: z.string(),
  outcome: z.string()
})
const envelope = z.looseObject({ notification: z.unknown() })
type Opener = (url: string) => boolean | Promise<boolean>
type Waiting = {
  stop: (error: Error) => void
  open?: Opener
  opening?: Promise<boolean>
}

export class DroidMcpSignInStopped extends DroidServiceCommandError {}

/** A challenge belongs only to a running sign-in; neither the URL nor provider messages escape it. */
export class DroidMcpSignIn {
  private readonly waiting = new Map<string, Waiting>()
  private readonly attempts = new Map<string, object>()

  receive(params: unknown): void {
    const notification = envelope.safeParse(params).data?.notification
    const challenge = required.safeParse(notification)
    if (challenge.success) {
      this.openLink(challenge.data)
      return
    }
    const outcome = completed.safeParse(notification)
    if (outcome.success) {
      const { serverName, outcome: status } = outcome.data
      if (status !== 'success') {
        this.stop(serverName, status === 'cancelled' ? 'mcpSignInCancelled' : 'mcpSignInIncomplete')
      }
    }
  }

  async run<T>(serverName: string, authenticate: () => Promise<T>, open?: Opener): Promise<T> {
    if (this.attempts.has(serverName)) {
      throw new DroidMcpSignInStopped('mcpSignInIncomplete')
    }
    const attempt = {}
    this.attempts.set(serverName, attempt)
    let stop: (error: Error) => void = () => {}
    const stopped = new Promise<never>((_resolve, reject) => {
      stop = reject
    })
    const entry: Waiting = { stop, open }
    this.waiting.set(serverName, entry)
    try {
      const authenticated = authenticate()
        .then(async (answer) => {
          if (entry.opening && !(await entry.opening)) {
            throw new DroidMcpSignInStopped('mcpLinkNotOpened')
          }
          return answer
        })
        .finally(() => {
          if (this.attempts.get(serverName) === attempt) {
            this.attempts.delete(serverName)
          }
        })
      return await Promise.race([authenticated, stopped])
    } finally {
      if (this.waiting.get(serverName) === entry) {
        this.waiting.delete(serverName)
      }
    }
  }

  close(): void {
    for (const serverName of this.waiting.keys()) {
      this.stop(serverName, 'mcpSignInIncomplete')
    }
    this.attempts.clear()
  }

  private openLink({ serverName, authUrl }: z.infer<typeof required>): void {
    const entry = this.waiting.get(serverName)
    if (!entry || entry.opening) {
      return
    }
    let opening: Promise<boolean>
    try {
      opening = Promise.resolve(entry.open?.(authUrl) ?? false)
    } catch {
      opening = Promise.resolve(false)
    }
    entry.opening = opening.catch(() => false)
    void entry.opening.then((opened) => {
      if (!opened && this.waiting.get(serverName) === entry) {
        this.stop(serverName, 'mcpLinkNotOpened')
      }
    })
  }

  private stop(serverName: string, key: DroidServiceErrorKey): void {
    this.waiting.get(serverName)?.stop(new DroidMcpSignInStopped(key))
  }
}
