import { z } from 'zod'
import { waitForPromiseWithSignal } from '../../shared/concurrency/abort-signal-reason'
import {
  deliverMcpSignInCallback,
  matchingMcpSignInCallback,
  readMcpSignInRedirectUri
} from '../native-chat/agent-session-wire/operations/structured-agent-session-mcp-callback'
import { DroidServiceCommandError } from './droid-service-command-error'

// Droid answers its authenticate request only once the browser step ends; the panel needs the link first.
const CHALLENGE_WAIT_MS = 30_000
const FINISH_WAIT_MS = 15_000

const required = z.looseObject({
  type: z.literal('mcp_auth_required'),
  serverName: z.string().min(1).max(200),
  authUrl: z.string().min(1)
})
const completed = z.looseObject({
  type: z.literal('mcp_auth_completed'),
  serverName: z.string(),
  outcome: z.string()
})
const envelope = z.looseObject({ notification: z.unknown() })

type Attempt = {
  url: string | null
  /** Settles once Droid answers the authenticate request. */
  answered: Promise<void>
  link: (url: string | null) => void
  stop: (error: Error) => void
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  const signal = AbortSignal.timeout(ms)
  try {
    return await waitForPromiseWithSignal(promise, signal)
  } catch (error) {
    if (signal.aborted) {
      return undefined
    }
    throw error
  }
}

/** Sign-ins running on one Droid child; a challenge's link reaches only the panel that asked. */
export class DroidMcpSignIn {
  private readonly attempts = new Map<string, Attempt>()

  receive(params: unknown): void {
    const notification = envelope.safeParse(params).data?.notification
    const challenge = required.safeParse(notification)
    if (challenge.success) {
      const attempt = this.attempts.get(challenge.data.serverName)
      if (attempt?.url === null) {
        attempt.url = challenge.data.authUrl
        attempt.link(attempt.url)
      }
      return
    }
    const outcome = completed.safeParse(notification)
    if (outcome.success && outcome.data.outcome !== 'success') {
      this.attempts
        .get(outcome.data.serverName)
        ?.stop(
          new DroidServiceCommandError(
            outcome.data.outcome === 'cancelled' ? 'mcpSignInCancelled' : 'mcpSignInIncomplete'
          )
        )
    }
  }

  /** Starts Droid's sign-in: its link, or null when Droid finished without asking for the browser. */
  async start(serverName: string, authenticate: () => Promise<void>): Promise<string | null> {
    const running = this.attempts.get(serverName)
    if (running?.url) {
      return running.url
    }
    if (running) {
      throw new DroidServiceCommandError('mcpSignInPending')
    }
    let link: Attempt['link'] = () => {}
    let stop: Attempt['stop'] = () => {}
    const linked = new Promise<string | null>((resolve, reject) => {
      link = resolve
      stop = reject
    })
    const attempt: Attempt = { url: null, answered: Promise.resolve(), link, stop }
    this.attempts.set(serverName, attempt)
    attempt.answered = authenticate().finally(() => {
      if (this.attempts.get(serverName) === attempt) {
        this.attempts.delete(serverName)
      }
    })
    attempt.answered.then(() => link(null), stop)
    const url = await within(linked, CHALLENGE_WAIT_MS)
    if (url === undefined) {
      throw new DroidServiceCommandError('mcpSignInPending')
    }
    return url
  }

  /** Hands Droid's loopback callback the address a browser on another device landed on. */
  async finish(serverName: string, callbackUrl: string): Promise<void> {
    const attempt = this.attempts.get(serverName)
    const callback = attempt?.url
      ? matchingMcpSignInCallback(callbackUrl, readMcpSignInRedirectUri(attempt.url))
      : null
    if (!attempt || !callback) {
      throw new DroidServiceCommandError('mcpCallbackMismatch')
    }
    await deliverMcpSignInCallback(callback, 'Droid')
    await within(attempt.answered, FINISH_WAIT_MS)
  }

  close(): void {
    for (const attempt of this.attempts.values()) {
      attempt.stop(new DroidServiceCommandError('mcpSignInIncomplete'))
    }
    this.attempts.clear()
  }
}
