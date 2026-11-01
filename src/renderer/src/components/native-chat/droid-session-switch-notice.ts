import { toast } from 'sonner'
import {
  switchDroidChatSession,
  type DroidSessionSwitchRequest
} from '@/lib/droid-chat-session-switch'

/**
 * Moves a Droid chat to another session and says so: `opened` once the move is over, `failed` when
 * the session could not be opened and no launch notice already said it. Settles when the move does.
 */
export function switchDroidSessionWithNotice(
  request: DroidSessionSwitchRequest,
  say: { opened?: () => string; failed: () => string }
): Promise<void> {
  const failed = (): void => {
    toast.error(say.failed())
  }
  try {
    return switchDroidChatSession(request).settlement.then((settled) => {
      if (settled.kind === 'structured') {
        if (say.opened) {
          toast(say.opened())
        }
      } else if (settled.kind === 'failed' && !settled.notified) {
        failed()
      }
    }, failed)
  } catch {
    failed()
    return Promise.resolve()
  }
}
