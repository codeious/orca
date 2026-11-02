import { z } from 'zod'
import {
  agentSessionFailureFact,
  providerDiagnostic
} from '../../shared/agent-session/failures/agent-session-failure'
import { agentSessionFailureWords } from '../../shared/agent-session/failures/agent-session-failure-words'
import type {
  AgentSessionCommandAdmission,
  StructuredAgentSessionCommandRun
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { DroidSession } from './droid-session'
import { DroidRpcError } from './droid-rpc-errors'
import { boundedDroidSummaryRead, waitForDroidCompactionSummary } from './droid-compaction-summary'

const resultSchema = z.looseObject({
  newSessionId: z.string().min(1).optional(),
  removedCount: z.number().int().nonnegative().optional()
})

export async function compactDroidSession(
  session: Pick<
    DroidSession,
    'request' | 'lane' | 'context' | 'droidSessionId' | 'readCompactionSummary' | 'continueIn'
  >,
  command: StructuredAgentSessionCommandRun
): Promise<AgentSessionCommandAdmission> {
  const id = session.droidSessionId
  const before = id ? await boundedDroidSummaryRead(() => session.readCompactionSummary(id)) : null
  session.lane.beginCommand(command)
  try {
    const answer = resultSchema.parse(
      await session.request('droid.compact_session', {}, { timeoutMs: 120_000 })
    )
    const moved = answer.newSessionId && answer.newSessionId !== id
    if (moved) {
      await session.continueIn(answer.newSessionId!)
    }
    const current = session.droidSessionId
    const summaryText = current
      ? await waitForDroidCompactionSummary(
          () => session.readCompactionSummary(current),
          moved ? null : before
        )
      : null
    session.lane.apply([
      {
        type: 'item.close',
        item: `compact-result:${command.turnId}`,
        body: {
          kind: 'status',
          text: answer.removedCount
            ? `Compacted ${answer.removedCount} messages.`
            : 'Conversation compacted.',
          ...(summaryText ? { summaryText } : {})
        }
      },
      { type: 'turn.end', turn: command.turnId, at: Date.now(), state: 'completed' }
    ])
    session.context.refreshInBackground()
    return { state: 'accepted', providerIdentity: null }
  } catch (error) {
    if (!(error instanceof DroidRpcError)) {
      throw error
    }
    session.lane.forgetCommand(command.turnId)
    return {
      state: 'rejected',
      ...agentSessionFailureWords(
        agentSessionFailureFact('providerRejected', {
          detail: providerDiagnostic(error.message, 'person')
        }),
        { agentName: 'Droid', surface: 'rejection' }
      )
    }
  }
}
