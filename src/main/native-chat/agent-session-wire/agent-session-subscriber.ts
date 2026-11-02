import type { AgentJournalCursor } from '../../../shared/agent-session-journal-identity'
import type { AgentSessionSubscribeEvent } from '../../../shared/agent-session/agent-session-wire'
import type { CurrentRequestsSubscriber } from './agent-session-current-requests'
import type { SubscriberFieldState } from './agent-session-subscriber-frame-fields'

export type AgentSessionSubscriberEmit = (event: AgentSessionSubscribeEvent) => void
export type Subscriber = CurrentRequestsSubscriber &
  SubscriberFieldState & {
    id: string
    closeMcpSignIn?: () => void
    emit: AgentSessionSubscriberEmit
    cursor: AgentJournalCursor
    fence: number
    snapshotCatchUp?: boolean
    /** Last frame’s current-work key; row-free changes still require a frame. */
    workView?: string
    /** Semantic history baseline actually emitted, independent of token/row progress. */
    historyView?: string
  }
