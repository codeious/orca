// `agentSession.droidCommand`: not a mutation, so no envelope or ledger; the child writes any chat row.

import { AgentSessionRefusalError } from '../../../shared/agent-session-wire-refusals'
import type {
  DroidHostCommand,
  DroidHostCommandRequest,
  DroidHostCommandResult
} from '../../../shared/droid-host-command'
import { droidMessageIdOfJournalItem } from '../../../shared/droid-rewind-message-id'
import { DroidHostTextError } from '../../droid/droid-host-text'
import { journalOpenReadRefusal } from '../agent-session-journal/journal-open-failure'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-mutation-context'
import { AGENT_SESSION_NOT_ATTACHED } from './structured-agent-session-mutation-refusals'

type DroidCommandContext = Pick<
  StructuredAgentSessionMutationContext,
  'deps' | 'serialize' | 'openConversation' | 'ensureAgent'
>

/** A rewind names a row of the chat; Droid knows the message by its own id, which only the journal says. */
function childCommand(
  session: Pick<StructuredAgentSessionHostSession, 'journal'>,
  command: DroidHostCommandRequest
): DroidHostCommand {
  if (command.name !== 'rewind') {
    return command
  }
  const { submissions } = session.journal.snapshot()
  const messageId = droidMessageIdOfJournalItem(command.itemId, submissions)
  if (messageId === null) {
    throw new DroidHostTextError('rewindUnknownMessage')
  }
  return { name: 'rewind', messageId }
}

/** The fence of the child that answers and the command it is given, or a null fence when no child should be started for it. */
async function childFence(
  context: DroidCommandContext,
  sessionId: string,
  request: DroidHostCommandRequest
): Promise<{ fence: number | null; command: DroidHostCommand }> {
  const session = await context.openConversation(sessionId).catch((error: unknown) => {
    throw journalOpenReadRefusal(error, context.deps.logger, sessionId)
  })
  if (!session) {
    throw new AgentSessionRefusalError(AGENT_SESSION_NOT_ATTACHED)
  }
  // Read before any child is started: a row Droid never named must not cost a start.
  const command = childCommand(session, request)
  if (session.child) {
    return { fence: session.child.fence, command }
  }
  // Credits live only in a running child, so one is not started to learn it has none.
  if (command.name === 'credits') {
    return { fence: null, command }
  }
  const prepared = await context.ensureAgent(sessionId)
  if (!prepared.ok) {
    throw new AgentSessionRefusalError(prepared.refusal)
  }
  const started = (await context.openConversation(sessionId))?.child
  if (!started) {
    throw new DroidHostTextError('notStarted')
  }
  return { fence: started.fence, command }
}

export async function runStructuredAgentSessionDroidCommand(
  context: DroidCommandContext,
  sessionId: string,
  request: DroidHostCommandRequest
): Promise<DroidHostCommandResult> {
  const { adapter } = context.deps
  if (!adapter.droidCommand) {
    throw new DroidHostTextError('commandsUnavailable')
  }
  // Only the fence is read under the session queue: a summary is a model call a Stop must not wait behind.
  const { fence, command } = await context.serialize(sessionId, () =>
    childFence(context, sessionId, request)
  )
  if (fence === null) {
    return { name: 'credits', factoryCredits: null }
  }
  return adapter.droidCommand({ sessionId, fence, command })
}
