import type { AgentSessionProviderHandleLink } from '../../shared/agent-session/lifecycle/agent-session-provider-handle'
import type { DroidAutonomyLevel } from '../../shared/droid-autonomy-options'
import { DROID_HANDLE_TRANSPORT } from './droid-agent-definition'

export type DroidResolvedLaunch = {
  command: string
  prefixArgs?: readonly string[]
  cwd: string
  env: Record<string, string>
  /** The Droid session this chat last held; the start loads it rather than creating another. */
  previous: AgentSessionProviderHandleLink | null
  /** What Agent Permissions asks for now, sent on every start and resume. */
  autonomyLevel: DroidAutonomyLevel
}

export function droidProviderLink(
  launch: Pick<DroidResolvedLaunch, 'previous'>,
  sessionId: string,
  fence: number,
  linkId: string,
  at: number
): AgentSessionProviderHandleLink {
  const { previous } = launch
  if (previous && previous.handle.nativeId !== sessionId) {
    throw new Error('Droid loaded a different session')
  }
  return {
    linkId,
    handle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: sessionId },
    origin: previous ? 'resumed' : 'created',
    mintedAtFence: fence,
    observedAt: at
  }
}
