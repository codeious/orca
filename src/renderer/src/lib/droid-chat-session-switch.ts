import { toast } from 'sonner'
import { agentSessionWriteFailureText } from '@/components/native-chat/agent-session-write-notice-text'
import {
  droidFreshSessionOptionPicks,
  type DroidFreshSessionSettings
} from '../../../shared/droid-fresh-session-settings'
import type { Tab } from '../../../shared/tab-types'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import {
  beginStructuredAgentLaunchSettlement,
  type StructuredAgentLaunchSettlement
} from '@/lib/structured-agent-launch-settlement'
import { holdStructuredAgentSessionLaunchOption } from '@/lib/structured-agent-session-launch-options'
import { openStructuredAgentSessionProvisionalTab } from '@/lib/structured-agent-session-provisional-tab'
import { structuredAgentSessionOwnerForTab } from '@/runtime/structured-agent-session-owner'
import { useAppStore } from '@/store'
import { findGroupForTab } from '@/store/slices/tab-group-state'

export type DroidSessionSwitchTarget =
  /** A Droid session that already exists (rewind, Spec handoff, compress, Open fork). Without
   *  `settings` it resumes as saved; with them, those picks are applied before it is used. */
  | { kind: 'existing'; droidSessionId: string; settings?: DroidFreshSessionSettings }
  /** A session Droid starts new (/clear, /new). */
  | { kind: 'fresh'; settings: DroidFreshSessionSettings }

export type DroidSessionSwitchRequest = {
  /** The Droid chat tab the switch starts from; its workspace and execution host carry over. */
  fromTabId: string
  /** `replace`: the new session takes the tab's place. `beside`: it opens in a new tab next to it. */
  placement: 'replace' | 'beside'
  target: DroidSessionSwitchTarget
  /** Sent once as the new session's first message, after its held settings. */
  firstMessage?: string
}

export type DroidSessionSwitch = {
  sessionId: string
  tab: Tab
  /** Settles once the new session is published, and for `replace` after the old tab has closed. */
  settlement: Promise<StructuredAgentLaunchSettlement>
}

function isTabInView(tab: Tab): boolean {
  const { groupsByWorktree } = useAppStore.getState()
  return findGroupForTab(groupsByWorktree, tab.worktreeId, tab.groupId)?.activeTabId === tab.id
}

/** Closing only releases the chat's view: its record and journal stay, so it stays in Session History. */
function closeReplacedTab(sourceTabId: string, newTabId: string): void {
  const state = useAppStore.getState()
  const source = state.getTab(sourceTabId)
  if (!source) {
    return
  }
  // Why: closing the tab in view would land the user on a neighbour instead of the new chat.
  if (isTabInView(source)) {
    state.activateTab(newTabId, { worktreeId: source.worktreeId })
  }
  state.closeUnifiedTab(source.id)
}

function holdFreshSettings(sessionId: string, settings: DroidFreshSessionSettings): void {
  for (const [id, encoded] of droidFreshSessionOptionPicks(settings)) {
    // A pick the host refuses leaves the session on its own default, so the person is told.
    void holdStructuredAgentSessionLaunchOption(sessionId, id, encoded)?.then((outcome) => {
      if (outcome.kind === 'refused') {
        toast.error(agentSessionWriteFailureText(outcome.failure, 'option'))
      }
    })
  }
}

/** The one way a Droid chat moves to another Droid session. */
export function switchDroidChatSession(request: DroidSessionSwitchRequest): DroidSessionSwitch {
  const state = useAppStore.getState()
  const source = state.getTab(request.fromTabId)
  if (source?.contentType !== 'agent-session' || source.agentSessionAgent !== 'droid') {
    throw new Error('Only a Droid chat can switch to another Droid session.')
  }
  const { target } = request
  const replace = request.placement === 'replace'
  const executionHostId = structuredAgentSessionOwnerForTab(state, source)

  const handle = beginStructuredAgentLaunchSettlement(
    source.worktreeId,
    'droid',
    {
      requestId: newAgentLaunchRequestId(),
      ...(executionHostId ? { executionHostId } : {}),
      ...(target.kind === 'existing'
        ? { resumeFrom: { providerSessionId: target.droidSessionId } }
        : {}),
      ...(request.firstMessage?.trim()
        ? { prompt: request.firstMessage, promptDelivery: 'auto-submit' as const }
        : {})
    },
    {}
  )
  try {
    if (target.settings) {
      holdFreshSettings(handle.sessionId, target.settings)
    }
    const tab = openStructuredAgentSessionProvisionalTab({
      worktreeId: source.worktreeId,
      executionHostId: handle.executionHostId,
      sessionId: handle.sessionId,
      agent: 'droid',
      activate: replace ? isTabInView(source) : true,
      placement: {
        afterTabId: source.id,
        ...(replace
          ? { customLabel: source.customLabel, color: source.color, isPinned: source.isPinned }
          : {})
      }
    })
    const settlement = handle.settlement.then((settled) => {
      // A launch that did not publish leaves the old chat where it was.
      if (replace && settled.kind === 'structured') {
        closeReplacedTab(source.id, tab.id)
      }
      return settled
    })
    return { sessionId: handle.sessionId, tab, settlement }
  } catch (error) {
    // Why: a launch without its tab would strand a late publication.
    handle.cancel()
    throw error
  }
}
