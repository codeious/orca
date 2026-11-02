import type { AgentSessionRewindRecord } from '../../../shared/agent-session/lifecycle/agent-session-rewind'
import type { AgentSessionRecordStore } from '../../runtime/agent-session/records/agent-session-record-store'

export function persistRewindRecord(
  store: AgentSessionRecordStore,
  sessionId: string,
  fence: number,
  rewind: AgentSessionRewindRecord
): Promise<unknown> {
  // Drop legacy copied history; the retained journal remains authoritative.
  const { retained: _retained, hydrationVerified: _hydrationVerified, ...current } = rewind
  return store.transitionHandoff(sessionId, (record) => {
    if (record.lease.runtimeFence !== fence) {
      throw new Error('agent_session_checkpoint_stale')
    }
    return { ...record, rewind: current }
  })
}
