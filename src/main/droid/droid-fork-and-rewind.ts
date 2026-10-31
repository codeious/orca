import { z } from 'zod'
import type { DroidHostCommandResult } from '../../shared/droid-host-command'
import type { DroidSession } from './droid-session'

type ForkAndRewindSession = Pick<DroidSession, 'request' | 'droidSessionId'>

// A fork or rewind copies a transcript and may touch files, but makes no model call.
const REQUEST_TIMEOUT_MS = 60_000

// Droid names the new session after this; the chat keeps its own name.
const FORK_TITLE = 'Forked conversation'
const REWIND_TITLE = 'Rewound conversation'

const forkedSchema = z.looseObject({ newSessionId: z.string().min(1).optional() })

const rewindInfoSchema = z.looseObject({
  availableFiles: z
    .array(
      z.looseObject({
        filePath: z.string(),
        contentHash: z.string(),
        size: z.number().nonnegative()
      })
    )
    .default([]),
  createdFiles: z.array(z.looseObject({ filePath: z.string() })).default([]),
  evictedFiles: z.array(z.looseObject({ filePath: z.string() })).default([])
})

const count = z.number().int().nonnegative().default(0)
const rewoundSchema = z.looseObject({
  newSessionId: z.string().min(1).optional(),
  restoredCount: count,
  deletedCount: count,
  failedRestoreCount: count,
  failedDeleteCount: count
})

export async function forkDroidSession(
  session: ForkAndRewindSession
): Promise<Extract<DroidHostCommandResult, { name: 'fork' }>> {
  const answer = await session.request(
    'droid.fork_session',
    { title: FORK_TITLE },
    { timeoutMs: REQUEST_TIMEOUT_MS }
  )
  const newSessionId = forkedSchema.safeParse(answer).data?.newSessionId
  // The same id would be the chat's own session, not a copy of it.
  if (newSessionId === undefined || newSessionId === session.droidSessionId) {
    throw new Error('Droid did not return a new session for the fork. Try again.')
  }
  return { name: 'fork', newSessionId }
}

export async function rewindDroidSession(
  session: ForkAndRewindSession,
  messageId: string
): Promise<Extract<DroidHostCommandResult, { name: 'rewind' }>> {
  const sessionId = session.droidSessionId
  if (sessionId === undefined) {
    throw new Error('Droid did not start for this chat. Send a message and try again.')
  }
  const info = rewindInfoSchema.safeParse(
    await session.request(
      'droid.get_rewind_info',
      { sessionId, messageId },
      { timeoutMs: REQUEST_TIMEOUT_MS }
    )
  )
  // Rewinding without knowing which files it touches would leave them as they are, unannounced.
  if (!info.success) {
    throw new Error('Droid could not say which files the rewind changes. Nothing was rewound.')
  }
  const { availableFiles, createdFiles, evictedFiles } = info.data
  const answer = await session.request(
    'droid.execute_rewind',
    {
      sessionId,
      messageId,
      filesToRestore: availableFiles.map(({ filePath, contentHash, size }) => ({
        filePath,
        contentHash,
        size
      })),
      filesToDelete: createdFiles.map(({ filePath }) => ({ filePath })),
      forkTitle: REWIND_TITLE
    },
    { timeoutMs: REQUEST_TIMEOUT_MS }
  )
  const done = rewoundSchema.safeParse(answer).data
  if (done?.newSessionId === undefined || done.newSessionId === sessionId) {
    throw new Error(
      'Droid rewound the conversation but did not return a new session. Open Session History to find it.'
    )
  }
  return {
    name: 'rewind',
    newSessionId: done.newSessionId,
    restoredCount: done.restoredCount,
    deletedCount: done.deletedCount,
    notRestoredCount: evictedFiles.length + done.failedRestoreCount + done.failedDeleteCount
  }
}
