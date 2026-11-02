import type { AgentExitWatchHost, AgentProcessExitWatch } from '../agent-process-exit-watch'
import type { AgentProcessIdentity } from '../agent-process-presence'
import type { ParsedAgentStatusPayload } from '../agent-status-types'
import type { AgentHookEventPayload } from './listener-event'
import type { HookListenerState } from './listener-state'
import { DROID_HOOK_SESSION_PROVIDER } from './providers/droid-hook-session'

export type ProviderHookSessionInput = {
  state: HookListenerState
  paneKey: string
  eventName: unknown
  hookPayload: Record<string, unknown>
  promptText: string
  sender?: AgentProcessIdentity
  previous: AgentHookEventPayload | undefined
  base: Pick<
    AgentHookEventPayload,
    'launchToken' | 'tabId' | 'worktreeId' | 'agentPresence' | 'providerSession'
  >
}

export type HookSessionNormalization = {
  normalize(): ParsedAgentStatusPayload | null
  providerSession: AgentHookEventPayload['providerSession'] | null
  suppressPrompt?: boolean
}

export type ProviderHookSessionResult =
  | { kind: 'handled'; event: AgentHookEventPayload | null }
  | { kind: 'normalize'; normalization: HookSessionNormalization }

export type ProviderHookSession = {
  admit(input: ProviderHookSessionInput): ProviderHookSessionResult
  exitMarker(state: HookListenerState, paneKey: string): object | undefined
}

const PROVIDERS: Readonly<Record<string, ProviderHookSession>> = {
  droid: DROID_HOOK_SESSION_PROVIDER
}

export function prepareProviderHookSession(source: string, input: ProviderHookSessionInput) {
  return PROVIDERS[source]?.admit(input)
}

export function watchProviderHookExit(
  state: HookListenerState,
  watch: AgentProcessExitWatch,
  event: AgentHookEventPayload,
  probe: AgentExitWatchHost['probe']
): void {
  if (event.hookEventName !== 'SessionEnd' || event.isReplay) {
    return
  }
  const provider = event.source && PROVIDERS[event.source]
  const marker = provider && provider.exitMarker(state, event.paneKey)
  if (marker) {
    watch.start(event.paneKey, {
      isCurrent: () => provider.exitMarker(state, event.paneKey) === marker,
      probe
    })
  }
}
