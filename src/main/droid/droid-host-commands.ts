import { z } from 'zod'
import type { DroidHostCommand, DroidHostCommandResult } from '../../shared/droid-host-command'
import { forkDroidSession, rewindDroidSession } from './droid-fork-and-rewind'
import type { DroidSession } from './droid-session'

// A summary is a model call over the whole conversation.
const COMPACT_TIMEOUT_MS = 120_000

const compactedSchema = z.looseObject({
  newSessionId: z.string().min(1).optional(),
  removedCount: z.number().int().nonnegative().optional()
})

function compressedWords(removedCount: number | null, moved: boolean): string {
  if (moved) {
    return 'Conversation compressed into a new Droid session. The earlier session stays in Session History.'
  }
  if (!removedCount) {
    return 'Conversation compressed to free up context.'
  }
  return `Conversation compressed. ${removedCount} earlier ${removedCount === 1 ? 'message was' : 'messages were'} summarized to free up context.`
}

async function compress(
  session: Pick<DroidSession, 'context' | 'request' | 'lane' | 'droidSessionId'>,
  instructions: string | undefined
): Promise<DroidHostCommandResult> {
  const answer = await session.request(
    'droid.compact_session',
    instructions ? { customInstructions: instructions } : {},
    { timeoutMs: COMPACT_TIMEOUT_MS }
  )
  const compacted = compactedSchema.safeParse(answer)
  const removedCount = compacted.data?.removedCount ?? null
  const reported = compacted.data?.newSessionId
  // The same id is a compaction in place; only a different one moves the chat.
  const newSessionId =
    reported !== undefined && reported !== session.droidSessionId ? reported : null
  session.lane.apply([
    {
      type: 'item.update',
      item: `compressed:${Date.now()}`,
      body: { kind: 'status', text: compressedWords(removedCount, newSessionId !== null) }
    }
  ])
  // No turn ends after a compaction, so nothing else moves the ring off its pre-compaction figure.
  if (newSessionId === null) {
    session.context.refreshInBackground()
  }
  return { name: 'compress', removedCount, newSessionId }
}

/** Answers a command the host claims for a Droid chat from the child, without sending a message. */
export async function runDroidHostCommand(
  session: Pick<DroidSession, 'context' | 'request' | 'lane' | 'droidSessionId'>,
  command: DroidHostCommand
): Promise<DroidHostCommandResult> {
  switch (command.name) {
    case 'context':
      return { name: 'context', report: (await session.context.refresh()) ?? null }
    case 'credits':
      return { name: 'credits', factoryCredits: session.context.credits ?? null }
    case 'compress':
      return compress(session, command.instructions)
    case 'fork':
      return forkDroidSession(session)
    case 'rewind':
      return rewindDroidSession(session, command.messageId)
  }
}
