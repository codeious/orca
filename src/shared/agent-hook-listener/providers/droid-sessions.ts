import { isSameAgentProcess, type AgentProcessIdentity } from '../../agent-process-presence'
import type { AgentMainAgentStatus, ParsedAgentStatusPayload } from '../../agent-status-types'
import type { CodexSubagentRoster } from '../../codex-subagent-roster'
import type { AgentHookEventPayload } from '../listener-event'
import { clearPaneTurnCacheState, type HookListenerState } from '../listener-state'
import { readString } from '../tool-input-preview'

const MAX_TRACKED_SESSIONS = 256

type DroidChild = {
  parentId: string
  /** Seen after a lead Stop, or started while the lead was stopped; an idle prompt does not end it. */
  outlivedStop: boolean
}

/** One Droid pane: the lead session that owns the row, and every other session as a flat child. */
export type DroidPaneSessions = {
  leadId: string
  /** The first session seen with no start behind it; a `calling_session_id` can still repoint it. */
  provisional: boolean
  lead?: AgentMainAgentStatus
  children: Map<string, DroidChild>
  /** Children that ended; a late second start for one (0.244) must not bring it back. */
  finished: Set<string>
  /** The children on show: working or waiting. */
  roster: CodexSubagentRoster
  leaseUntil?: number
  /** Set when the lead's SessionEnd starts an exit watch; any later lead hook clears it. */
  exitMarker?: object
}

/** The marker an exit watch holds; it goes stale when the lead speaks again or the pane is cleared. */
export function droidExitMarker(state: HookListenerState, paneKey: string): object | undefined {
  return state.droidSessionsByPaneKey.get(paneKey)?.exitMarker
}

export type DroidHookAdmission =
  | { kind: 'skip' }
  /** Re-publish the stored row so the host's owner check runs; `settled` also clears child work. */
  | { kind: 'restate'; sessionEnd?: true; settled?: true }
  | { kind: 'lead'; sessions?: DroidPaneSessions }
  | { kind: 'child'; sessions: DroidPaneSessions; sessionId: string }

const SKIP: DroidHookAdmission = { kind: 'skip' }

function boundedAdd<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value)
  if (map.size > MAX_TRACKED_SESSIONS) {
    const oldest = map.keys().next()
    if (!oldest.done) {
      map.delete(oldest.value)
    }
  }
}

function createSessions(
  state: HookListenerState,
  paneKey: string,
  leadId: string,
  provisional: boolean
): DroidPaneSessions {
  const sessions: DroidPaneSessions = {
    leadId,
    provisional,
    children: new Map(),
    finished: new Set(),
    roster: new Map()
  }
  state.droidSessionsByPaneKey.set(paneKey, sessions)
  return sessions
}

function chainRoot(sessions: DroidPaneSessions, id: string): string {
  const seen = new Set<string>()
  let current = id
  while (!seen.has(current)) {
    seen.add(current)
    const parent = sessions.children.get(current)?.parentId
    if (!parent) {
      return current
    }
    current = parent
  }
  return current
}

function recordChild(sessions: DroidPaneSessions, id: string, parentId: string): void {
  if (!sessions.children.has(id)) {
    boundedAdd(sessions.children, id, {
      parentId,
      outlivedStop: sessions.lead?.state === 'done'
    })
  }
}

function confirmOrRepointLead(sessions: DroidPaneSessions, parentId: string): void {
  const root = chainRoot(sessions, parentId)
  if (root !== sessions.leadId) {
    recordChild(sessions, sessions.leadId, root)
    sessions.leadId = root
    sessions.lead = undefined
  }
  sessions.provisional = false
}

/** An owner is a live row with a captured process. */
function rowOwner(previous: AgentHookEventPayload | undefined): AgentProcessIdentity | undefined {
  const presence = previous?.agentPresence
  return presence && !presence.ended && !previous?.providerSessionOnly
    ? presence.process
    : undefined
}

/** A sender that is not the row's owner process is foreign. */
function isForeignSender(
  previous: AgentHookEventPayload | undefined,
  sender: AgentProcessIdentity | undefined
): boolean {
  const owner = rowOwner(previous)
  return owner !== undefined && !(sender && isSameAgentProcess(owner, sender))
}

function clearExitMarker(state: HookListenerState, paneKey: string): void {
  const sessions = state.droidSessionsByPaneKey.get(paneKey)
  if (sessions) {
    sessions.exitMarker = undefined
  }
}

function restoredSessions(
  state: HookListenerState,
  paneKey: string,
  previous: AgentHookEventPayload | undefined
): DroidPaneSessions | undefined {
  const id = previous?.providerSession?.id
  return id && previous.payload.agentType === 'droid' && !previous.agentPresence?.ended
    ? createSessions(state, paneKey, id, false)
    : undefined
}

function admitStart(
  state: HookListenerState,
  paneKey: string,
  sessions: DroidPaneSessions | undefined,
  previous: AgentHookEventPayload | undefined,
  ids: { sessionId: string; parentId?: string },
  sender: AgentProcessIdentity | undefined
): DroidHookAdmission {
  const { sessionId, parentId } = ids
  if (parentId) {
    const known = sessions ?? createSessions(state, paneKey, parentId, true)
    if (known.finished.has(sessionId)) {
      return SKIP
    }
    if (known.provisional) {
      confirmOrRepointLead(known, parentId)
    }
    // Why: a confirmed lead is never a child, but a provisional one can turn out to be.
    if (sessionId !== known.leadId) {
      recordChild(known, sessionId, parentId)
    }
    return SKIP
  }
  clearExitMarker(state, paneKey)
  // Why: a stored row with no owner cannot tell a relaunch of the same session from /resume of it.
  const rowLacksOwner = previous !== undefined && rowOwner(previous) === undefined
  if (sessions?.leadId === sessionId && sender && !rowLacksOwner) {
    return SKIP
  }
  const hadChildWork = (sessions?.roster.size ?? 0) > 0
  createSessions(state, paneKey, sessionId, false)
  clearPaneTurnCacheState(state, paneKey)
  return hadChildWork && previous ? { kind: 'restate', settled: true } : SKIP
}

/**
 * Sorts one Droid hook into the lead's, a child's, or neither, and records what a start teaches.
 * Events with no session id keep the pre-split behavior: they are the lead's.
 */
export function admitDroidHook(
  state: HookListenerState,
  paneKey: string,
  eventName: unknown,
  hookPayload: Record<string, unknown>,
  sender: AgentProcessIdentity | undefined
): DroidHookAdmission {
  const previous = state.lastStatusByPaneKey.get(paneKey)
  if (isForeignSender(previous, sender)) {
    return previous ? { kind: 'restate' } : SKIP
  }
  const sessionId = readString(hookPayload, 'session_id')
  if (!sessionId) {
    clearExitMarker(state, paneKey)
    return { kind: 'lead' }
  }
  const sessions =
    state.droidSessionsByPaneKey.get(paneKey) ?? restoredSessions(state, paneKey, previous)
  if (eventName === 'SessionStart') {
    const parentId = readString(hookPayload, 'calling_session_id')
    return admitStart(state, paneKey, sessions, previous, { sessionId, parentId }, sender)
  }
  if (!sessions) {
    return {
      kind: 'lead',
      sessions: createSessions(state, paneKey, sessionId, true)
    }
  }
  if (sessionId === sessions.leadId) {
    if (eventName === 'SessionEnd') {
      if (!sender || !previous) {
        return SKIP
      }
      sessions.exitMarker = {}
      return { kind: 'restate', sessionEnd: true }
    }
    sessions.exitMarker = undefined
    return { kind: 'lead', sessions }
  }
  return sessions.children.has(sessionId) ? { kind: 'child', sessions, sessionId } : SKIP
}

/**
 * The event for an admission that settles without a dispatch: null for a skip, else the stored row
 * re-published under the sender, so the host's owner check and exit watch see the event while the
 * row stays as it was. `settled` also clears child work, for a lead replaced while children showed.
 */
export function restatedDroidEvent(
  previous: AgentHookEventPayload | undefined,
  admission: Extract<DroidHookAdmission, { kind: 'skip' | 'restate' }>,
  base: Pick<
    AgentHookEventPayload,
    'launchToken' | 'tabId' | 'worktreeId' | 'agentPresence' | 'providerSession'
  >
): AgentHookEventPayload | null {
  if (!previous || admission.kind === 'skip') {
    return null
  }
  const payload: ParsedAgentStatusPayload = admission.settled
    ? {
        ...previous.payload,
        state: 'done',
        workingMode: undefined,
        subagents: undefined,
        mainAgent: undefined
      }
    : previous.payload
  return {
    ...base,
    paneKey: previous.paneKey,
    source: 'droid',
    connectionId: null,
    // Why: the restated row is the one the host keeps for resume, so it must name the lead the pane
    // holds: the replacement's own id once the lead changed, never the sender's.
    providerSession: admission.settled ? base.providerSession : previous.providerSession,
    ...(admission.sessionEnd ? { hookEventName: 'SessionEnd' } : {}),
    payload
  }
}

/**
 * A child event restates the lead's id as the pane's resume identity: the host keeps a prior one
 * across child events for Codex only, so omitting it would erase the pane's.
 */
export function droidRowProviderSession(
  admission: DroidHookAdmission | undefined,
  own: AgentHookEventPayload['providerSession'] | null
): AgentHookEventPayload['providerSession'] | null {
  return admission?.kind === 'child' ? { key: 'session_id', id: admission.sessions.leadId } : own
}
