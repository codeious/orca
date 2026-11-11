import type { ComponentProps, ReactNode } from 'react'
import { NativeChatEmptyState } from './host-access/NativeChatEmptyState'
import { NativeChatEmptyPane } from './host-access/NativeChatEmptyPane'
import { NativeChatLoadingCue } from './host-access/NativeChatLoadingCue'
import type {
  NativeChatViewState,
  structuredChatHistoryPhase
} from './session/status/native-chat-view-state'
import type { StructuredAgentSessionReadFailureNotice } from './messages/notices/structured-agent-session-read-failure-notice'

export function NativeChatStructuredHistoryState({
  kind,
  historyPhase,
  readFailure,
  slot,
  agent,
  children
}: {
  kind: NativeChatViewState['kind']
  historyPhase: ReturnType<typeof structuredChatHistoryPhase>
  readFailure: StructuredAgentSessionReadFailureNotice | null
  slot: ComponentProps<typeof NativeChatEmptyPane>['slot']
  agent: ComponentProps<typeof NativeChatEmptyPane>['agent']
  children: ReactNode
}) {
  if (kind === 'loading' || (kind === 'error' && !readFailure)) {
    return historyPhase !== 'unread' && <NativeChatLoadingCue />
  }
  if (kind === 'error') {
    return (
      <NativeChatEmptyState
        kind="error"
        retrying={!readFailure?.final}
        {...(readFailure?.named ? { headline: readFailure.text } : {})}
      />
    )
  }
  if (kind === 'empty') {
    return <NativeChatEmptyPane slot={slot} agent={agent} />
  }
  return children
}
