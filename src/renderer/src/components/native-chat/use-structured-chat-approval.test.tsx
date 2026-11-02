// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { setLocalRuntimeCapabilitiesForTests } from '@/runtime/local-runtime-capabilities'
import { AGENT_SESSION_APPROVAL_NOTES_CAPABILITY } from '../../../../shared/agent-session/structured-agent-session-surface-capabilities'
import type { AgentJournalApprovalItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import { useStructuredChatApproval } from './use-structured-chat-approval'

afterEach(() => setLocalRuntimeCapabilitiesForTests(null))

it.each([false, true])('only offers note fields while the host supports them: %s', (supported) => {
  setLocalRuntimeCapabilitiesForTests(supported ? [AGENT_SESSION_APPROVAL_NOTES_CAPABILITY] : [])
  const body: AgentJournalApprovalItem = {
    kind: 'approval',
    title: 'Review',
    detail: null,
    acceptsComment: true,
    acceptsPlanEdit: true,
    options: [],
    resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
  }
  const { result } = renderHook(() => useStructuredChatApproval(body, { kind: 'local' }))
  if (supported) {
    expect(result.current).toMatchObject({ acceptsComment: true, acceptsPlanEdit: true })
  } else {
    expect(result.current).not.toHaveProperty('acceptsComment')
    expect(result.current).not.toHaveProperty('acceptsPlanEdit')
  }
})
