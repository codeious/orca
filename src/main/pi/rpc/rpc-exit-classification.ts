import {
  agentSessionFailureFact,
  providerDiagnostic,
  providerDiagnosticOf,
  type SubmissionRejectionFact
} from '../../../shared/agent-session/failures/agent-session-failure'
import { providerStartupFailureFact } from '../../native-chat/agent-session-wire/startup/structured-agent-session-failure-text'
import { providerSpawnAbsent } from '../../provider-process/provider-executable-missing'
import { JsonlRpcResponseError } from '../../jsonl-rpc/peer-reply'
import { providerOutcomeLost } from '../../provider-process/provider-process-exit-status'

/** How an unexpected Pi exit reads; a Pi that never ran names its missing CLI or folder. */
export function piExitFailure(error: Error, cause: Error): SubmissionRejectionFact {
  if (providerOutcomeLost(error) || providerOutcomeLost(cause)) {
    return agentSessionFailureFact('hostFault')
  }
  if (providerSpawnAbsent(error)) {
    return providerStartupFailureFact(error)
  }
  return agentSessionFailureFact('providerExited', {
    detail:
      providerDiagnosticOf(cause) ??
      providerDiagnosticOf(error) ??
      (cause instanceof JsonlRpcResponseError
        ? providerDiagnostic(cause.message, 'person')
        : undefined)
  })
}
