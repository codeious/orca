import type { AgentSessionExecutionLocation } from '../../shared/agent-session/lifecycle/agent-session-record'
import type { StructuredAgentId } from '../../shared/agent-session/lifecycle/agent-session-provider-handle'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { AgentCliInstallationProblem } from '../../shared/agent-cli-installation-problem'

export type StructuredAgentSessionCreateSupport = {
  supported: boolean
  reason?: 'agent' | 'remote' | 'wsl'
  agentInstallation?: AgentCliInstallationProblem
}

export function resolveStructuredAgentSessionCreateSupport(input: {
  location: AgentSessionExecutionLocation
  adapterSupportsCreate: boolean
  agentInstallation?: AgentCliInstallationProblem
}): StructuredAgentSessionCreateSupport {
  if (!input.adapterSupportsCreate) {
    const reason =
      input.location.executionHostId !== LOCAL_EXECUTION_HOST_ID
        ? 'remote'
        : input.location.wslDistro
          ? 'wsl'
          : 'agent'
    return {
      supported: false,
      reason,
      ...(reason === 'agent' && input.agentInstallation
        ? { agentInstallation: input.agentInstallation }
        : {})
    }
  }
  return { supported: true }
}

export type StructuredAgentSessionCreateSupportCheck = 'location' | 'installed-agent'

/** Log the failing check once per terminal fallback; omit paths and environment values. */
export function warnStructuredAgentSessionCreateUnsupported(
  agent: StructuredAgentId,
  support: StructuredAgentSessionCreateSupport,
  check: StructuredAgentSessionCreateSupportCheck
): void {
  if (!support.supported) {
    console.warn(
      `[structured-create-support] ${agent} unsupported: ${check} check refused (reason ${support.reason ?? 'none'})`
    )
  }
}
