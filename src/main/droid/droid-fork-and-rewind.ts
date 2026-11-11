import { z } from 'zod'
import type { DroidSession } from './droid-session'

type ForkAndRewindSession = Pick<DroidSession, 'request' | 'droidSessionId'>

// Conversation actions make no model call and leave files on disk alone.
const REQUEST_TIMEOUT_MS = 60_000

// Droid names the new session after this; the chat keeps its own name.
const FORK_TITLE = 'Forked conversation'
const REWIND_TITLE = 'Rewound conversation'

const forkedSchema = z.looseObject({ newSessionId: z.string().min(1).optional() })

export async function forkDroidSession(
  session: ForkAndRewindSession
): Promise<{ newSessionId: string }> {
  const answer = await session.request(
    'droid.fork_session',
    { title: FORK_TITLE },
    { timeoutMs: REQUEST_TIMEOUT_MS }
  )
  const newSessionId = forkedSchema.safeParse(answer).data?.newSessionId
  // The same id would be the chat's own session, not a copy of it.
  if (newSessionId === undefined || newSessionId === session.droidSessionId) {
    throw new Error('Droid did not confirm a new fork')
  }
  return { newSessionId }
}

export async function rewindDroidSession(
  session: ForkAndRewindSession,
  messageId: string
): Promise<{ newSessionId: string }> {
  const sessionId = session.droidSessionId
  if (sessionId === undefined) {
    throw new Error('Droid has not started this session')
  }
  const answer = await session.request(
    'droid.execute_rewind',
    {
      sessionId,
      messageId,
      filesToRestore: [],
      filesToDelete: [],
      forkTitle: REWIND_TITLE
    },
    { timeoutMs: REQUEST_TIMEOUT_MS }
  )
  const done = forkedSchema.safeParse(answer).data
  if (done?.newSessionId === undefined || done.newSessionId === sessionId) {
    throw new Error('Droid did not confirm the rewound session')
  }
  return { newSessionId: done.newSessionId }
}
