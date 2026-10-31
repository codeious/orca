import { z } from 'zod'
import { normalizeAgentSessionConversationName } from '../../shared/agent-session-conversation-name'
import type { DroidHostCommand, DroidHostCommandResult } from '../../shared/droid-host-command'
import { forkDroidSession, rewindDroidSession } from './droid-fork-and-rewind'
import { droidHostText, DroidHostTextError } from './droid-host-text'
import { runDroidMcp } from './droid-mcp'
import { isDroidMethodNotFound } from './droid-missing-method'
import type { DroidSession } from './droid-session'
import { runDroidSkills } from './droid-skills'
import { changeDroidWorkingFolder } from './droid-working-folder'

// A summary is a model call over the whole conversation.
const COMPACT_TIMEOUT_MS = 120_000

const compactedSchema = z.looseObject({
  newSessionId: z.string().min(1).optional(),
  removedCount: z.number().int().nonnegative().optional()
})

function compressedWords(removedCount: number | null, moved: boolean) {
  if (moved) {
    return droidHostText('compressMoved')
  }
  if (!removedCount) {
    return droidHostText('compressDone')
  }
  return droidHostText(removedCount === 1 ? 'compressOne' : 'compressMany', { removedCount })
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
      body: { kind: 'status', ...compressedWords(removedCount, newSessionId !== null) }
    }
  ])
  // No turn ends after a compaction, so nothing else moves the ring off its pre-compaction figure.
  if (newSessionId === null) {
    session.context.refreshInBackground()
  }
  return { name: 'compress', removedCount, newSessionId }
}

const renamedSchema = z.looseObject({ success: z.unknown() })
const bugReportSchema = z.looseObject({ bugReportId: z.string().min(1) })

async function submitBug(
  session: Pick<DroidSession, 'request'>,
  userComment = ''
): Promise<DroidHostCommandResult> {
  try {
    const answer = await session.request('droid.submit_bug_report', { userComment })
    return { name: 'bug', submitted: bugReportSchema.safeParse(answer).success }
  } catch (error) {
    if (isDroidMethodNotFound(error)) {
      throw error
    }
    // A report error may echo its body. Nothing of it belongs in chat or logs.
    return { name: 'bug', submitted: false }
  }
}

async function rename(
  session: Pick<DroidSession, 'request'>,
  requested: string
): Promise<DroidHostCommandResult> {
  const title = normalizeAgentSessionConversationName(requested)
  if (title === null) {
    throw new DroidHostTextError('renameEmpty')
  }
  const answer = await session.request('droid.rename_session', { title })
  // An answer with no verdict at all is taken as the rename; any verdict that is not `true` is a refusal.
  const verdict = renamedSchema.safeParse(answer).data?.success
  if (verdict !== undefined && verdict !== true) {
    throw new DroidHostTextError('renameRefused')
  }
  return { name: 'rename', title }
}

/** Answers a command the host claims for a Droid chat from the child, without sending a message. */
export async function runDroidHostCommand(
  session: Pick<
    DroidSession,
    'context' | 'request' | 'lane' | 'droidSessionId' | 'workspace' | 'mcpSignIn'
  >,
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
    case 'rename':
      return rename(session, command.title)
    case 'cwd':
      return changeDroidWorkingFolder(session, command.path)
    case 'skills':
      return runDroidSkills(session, command.toggle)
    case 'mcp':
      return runDroidMcp(session, command.action)
    case 'bug':
      return submitBug(session, command.userComment)
    case 'rewind':
      return rewindDroidSession(session, command.messageId)
  }
}
