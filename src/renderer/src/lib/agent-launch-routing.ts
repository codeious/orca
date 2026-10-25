import type { ProjectExecutionRuntimeResolution } from '../../../shared/project-execution-runtime'
import {
  resolveNativeChatLaunchChoice,
  resolveStructuredNativeChatSupport,
  type NativeChatDefaultSettings,
  type StructuredNativeChatBlocker
} from '../../../shared/structured-native-chat-launch-route'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { WorkspaceLaunchKind } from '../../../shared/workspace-launch-kind'
import type { NativeChatLaunchPromptDelivery } from '@/lib/native-chat-launch-prompt-delivery'

export type AgentLaunchRoute = 'structured-native-chat' | 'terminal-tui'

export type AgentLaunchRoutingInput = {
  agent: TuiAgent
  settings: NativeChatDefaultSettings | null | undefined
  executionHostId: string
  /** Capabilities of the target host; `null` = not yet established. */
  hostCapabilities: readonly string[] | null
  /** What this client advertises to a paired host. */
  clientCapabilities?: readonly string[]
  workspaceKind?: WorkspaceLaunchKind
  projectRuntime?: ProjectExecutionRuntimeResolution | null
  promptDelivery?: NativeChatLaunchPromptDelivery
  launchText?: string
  nativeChatTranscriptIsLocalReadable?: boolean
  startsOutsideWorkspaceRoot?: boolean
  /** The agents the target host listed as structured; absent until it has. */
  hostStructuredAgents?: readonly string[]
}

export function resolveAgentLaunchRoute(input: AgentLaunchRoutingInput): AgentLaunchRoute {
  return userChoosesChat(input) && structuredAgentLaunchSupported(input)
    ? 'structured-native-chat'
    : 'terminal-tui'
}

function userChoosesChat(input: Pick<AgentLaunchRoutingInput, 'agent' | 'settings'>): boolean {
  return resolveNativeChatLaunchChoice(input.settings, input.agent).structured
}

// Explicit chat requests (resume history in a new chat) follow neither the Chat UI switch nor the
// agent's launch setting.
export function structuredAgentLaunchSupported(
  input: Omit<AgentLaunchRoutingInput, 'launchText'>
): boolean {
  return structuredAgentLaunchSupport(input).supported
}

function structuredAgentLaunchSupport(input: Omit<AgentLaunchRoutingInput, 'launchText'>) {
  return resolveStructuredNativeChatSupport({
    agent: input.agent,
    executionHostId: input.executionHostId,
    hostCapabilities: input.hostCapabilities,
    ...(input.clientCapabilities ? { clientCapabilities: input.clientCapabilities } : {}),
    workspaceKind: input.workspaceKind,
    projectRuntime: input.projectRuntime,
    startsOutsideWorkspaceRoot: input.startsOutsideWorkspaceRoot,
    ...(input.hostStructuredAgents ? { hostStructuredAgents: input.hostStructuredAgents } : {})
  })
}

/** Why a launch the user chose to open as a chat did not route to it; null when it did, or when
 *  the user chose a terminal. Diagnostics only: the route itself is `resolveAgentLaunchRoute`. */
export function structuredAgentLaunchDowngrade(
  input: AgentLaunchRoutingInput,
  route: AgentLaunchRoute
): StructuredNativeChatBlocker | null {
  if (route === 'structured-native-chat' || !userChoosesChat(input)) {
    return null
  }
  const support = structuredAgentLaunchSupport(input)
  return support.supported ? null : support.blocker
}
