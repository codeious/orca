import type { AgentCliInstallationProblem } from '../agent-launch/catalog/agent-cli-installation-problem'

/** Why a host cannot open a structured chat for an agent there; `windows`: none exists on a Windows host. */
export type StructuredAgentCreateSupportReason =
  | 'agent'
  | 'remote'
  | 'wsl'
  | 'windows'
  | 'chat-program'

/** The `agentSession.createSupport` reply, read by the desktop and the phone alike. */
export type StructuredAgentCreateSupportReply = {
  supported: boolean
  reason?: StructuredAgentCreateSupportReason
  /** Present when `reason` is `agent` because the installed CLI is too old. */
  agentInstallation?: AgentCliInstallationProblem
}
