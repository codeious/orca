// `agentSession.droidCommand`: not a mutation, so no envelope or ledger; the child writes any chat row.

import { AgentSessionRefusalError } from '../../../shared/agent-session-wire-refusals'
import type { DroidHostCommand, DroidHostCommandResult } from '../../../shared/droid-host-command'
import { journalOpenReadRefusal } from '../agent-session-journal/journal-open-failure'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-mutation-context'
import { AGENT_SESSION_NOT_ATTACHED } from './structured-agent-session-mutation-refusals'

type DroidCommandContext = Pick<
  StructuredAgentSessionMutationContext,
  'deps' | 'serialize' | 'openConversation' | 'ensureAgent'
>

/** The fence of the child that answers, or null when it should not be started for this command. */
async function childFence(
  context: DroidCommandContext,
  sessionId: string,
  command: DroidHostCommand
): Promise<number | null> {
  const session = await context.openConversation(sessionId).catch((error: unknown) => {
    throw journalOpenReadRefusal(error, context.deps.logger, sessionId)
  })
  if (!session) {
    throw new AgentSessionRefusalError(AGENT_SESSION_NOT_ATTACHED)
  }
  if (session.child) {
    return session.child.fence
  }
  // Credits live only in a running child, so one is not started to learn it has none.
  if (command.name === 'credits') {
    return null
  }
  const prepared = await context.ensureAgent(sessionId)
  if (!prepared.ok) {
    throw new AgentSessionRefusalError(prepared.refusal)
  }
  const started = (await context.openConversation(sessionId))?.child
  if (!started) {
    throw new Error('Droid did not start for this chat. Send a message and try again.')
  }
  return started.fence
}

export async function runStructuredAgentSessionDroidCommand(
  context: DroidCommandContext,
  sessionId: string,
  command: DroidHostCommand
): Promise<DroidHostCommandResult> {
  const { adapter } = context.deps
  if (!adapter.droidCommand) {
    throw new Error('Droid commands are unavailable for this chat.')
  }
  // Only the fence is read under the session queue: a summary is a model call a Stop must not wait behind.
  const fence = await context.serialize(sessionId, () => childFence(context, sessionId, command))
  if (fence === null) {
    return { name: 'credits', factoryCredits: null }
  }
  return adapter.droidCommand({ sessionId, fence, command })
}
