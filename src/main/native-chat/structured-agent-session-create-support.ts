import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import type { StructuredAgentId } from '../../shared/agent-session-provider-handle'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { UnsupportedAgentVersion } from '../../shared/unsupported-agent-version'

export type { UnsupportedAgentVersion } from '../../shared/unsupported-agent-version'

export type StructuredAgentSessionCreateSupport = {
  supported: boolean
  reason?: 'agent' | 'remote' | 'wsl'
  /** With `reason: 'agent'`, when the installed release alone is why. A reader that does not know
   *  it still reads the reason; this only adds the release to the words. */
  unsupportedVersion?: UnsupportedAgentVersion
}

/** The create-support verdict: the adapter's location answer, with the reason a refusal names. */
export function resolveStructuredAgentSessionCreateSupport(input: {
  location: AgentSessionExecutionLocation
  adapterSupportsCreate: boolean
  unsupportedVersion?: UnsupportedAgentVersion
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
      ...(reason === 'agent' && input.unsupportedVersion
        ? { unsupportedVersion: input.unsupportedVersion }
        : {})
    }
  }
  return { supported: true }
}

/** Which create-support check said no: where the chat would run, or the installed agent (its
 *  binary and version on this host). */
export type StructuredAgentSessionCreateSupportCheck = 'location' | 'installed-agent'

/** One main-log line per create-support verdict that sends a launch to the terminal; names the
 *  check and never a path or environment value. */
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
