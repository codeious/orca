import type { OrcaRuntimeWithGetPtyRecordForPaneKey } from '../../mailbox/routing/terminal-pane-mail-routing'
import { escalateChatWorkerError } from './chat-worker-error-escalation'
import type { StructuredAgentSessionRequestFailure } from '../../../../native-chat/agent-session-wire/observations/structured-agent-session-request-failures'
import { RuntimeStructuredAgentHost } from '../../../agent-session/installation/runtime-structured-agent-host'
import type { StructuredAgentSessionRuntimeDeps } from '../../../agent-session/installation/structured-agent-session-runtime-contract'
import type { StructuredSessionTabPublicationInput } from '../../../session-tabs/structured-session-tab-publication'

export abstract class RuntimeChatWorkerEvents extends RuntimeStructuredAgentHost {
  abstract onStructuredSessionStatusForMail(
    ...args: Parameters<OrcaRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionStatusForMail']>
  ): ReturnType<OrcaRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionStatusForMail']>

  abstract onStructuredSessionTabHidden(
    ...args: Parameters<OrcaRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionTabHidden']>
  ): ReturnType<OrcaRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionTabHidden']>

  abstract publishStructuredAgentSessionTab(
    input: StructuredSessionTabPublicationInput
  ): Promise<void>

  /** Tab effects the structured host asks of this runtime, including a provider's continuation chat. */
  structuredSessionTabDeps(): Pick<
    StructuredAgentSessionRuntimeDeps,
    'onSessionTabHidden' | 'publishContinuationTab'
  > {
    return {
      onSessionTabHidden: (sessionId) => this.onStructuredSessionTabHidden(sessionId),
      publishContinuationTab: (input) =>
        this.publishStructuredAgentSessionTab({ ...input, activate: true })
    }
  }

  abstract structuredChatMailOwed(
    ...args: Parameters<OrcaRuntimeWithGetPtyRecordForPaneKey['structuredChatMailOwed']>
  ): ReturnType<OrcaRuntimeWithGetPtyRecordForPaneKey['structuredChatMailOwed']>

  /** A chat worker whose request settled failed tells the Run that dispatched it. */
  onStructuredRequestFailureForErrorMail(failure: StructuredAgentSessionRequestFailure): void {
    void escalateChatWorkerError(failure, this.workerTurnStopReportDeps)
  }
}
