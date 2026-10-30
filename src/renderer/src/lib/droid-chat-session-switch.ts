import { DROID_AUTONOMY_OPTION_ID } from '../../../shared/droid-autonomy-options'
import {
  DROID_SPEC_EFFORT_OPTION_ID,
  DROID_SPEC_MODEL_OPTION_ID
} from '../../../shared/droid-spec-pair-options'
import { encodeStructuredAgentSessionOptionValue } from '../../../shared/structured-agent-session-option-codec'
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

/** What a new Droid session starts with. A missing field is left to the new-chat defaults. */
export type DroidFreshSessionSettings = {
  model?: string
  effort?: string
  autonomyLevel?: string
  /** Droid's Spec interaction mode; `false` starts in Auto even if the saved defaults say Spec. */
  spec?: boolean
  /** A model id, or `DROID_SPEC_SAME_AS_MAIN` to run Spec on the main model. */
  specModel?: string
  specEffort?: string
}

export type DroidSessionSwitchTarget =
  /** A Droid session that already exists (rewind, Spec handoff, compress, Open fork). */
  | { kind: 'existing'; droidSessionId: string }
  /** A session Droid starts new (/clear, /new). */
  | { kind: 'fresh'; settings: DroidFreshSessionSettings }

export type DroidSessionSwitchRequest = {
  /** The Droid chat tab the switch starts from; its workspace and execution host carry over. */
  fromTabId: string
  /** `replace`: the new session takes the tab's place. `beside`: it opens in a new tab next to it. */
  placement: 'replace' | 'beside'
  target: DroidSessionSwitchTarget
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

/** Model goes first: holding it drops the picks held under the model it replaces. */
function holdFreshSettings(sessionId: string, settings: DroidFreshSessionSettings): void {
  const picks: [string, string | undefined][] = [
    ['model', settings.model],
    ['effort', settings.effort],
    [
      'planMode',
      settings.spec === undefined
        ? undefined
        : (encodeStructuredAgentSessionOptionValue('planMode', settings.spec) ?? undefined)
    ],
    [DROID_SPEC_MODEL_OPTION_ID, settings.specModel],
    [DROID_SPEC_EFFORT_OPTION_ID, settings.specEffort],
    [DROID_AUTONOMY_OPTION_ID, settings.autonomyLevel]
  ]
  for (const [id, encoded] of picks) {
    if (encoded !== undefined) {
      void holdStructuredAgentSessionLaunchOption(sessionId, id, encoded)
    }
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
        : {})
    },
    {}
  )
  try {
    if (target.kind === 'fresh') {
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
