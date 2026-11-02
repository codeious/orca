import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalApprovalItem } from '../../../src/shared/agent-session/journal/agent-session-journal-types'
import { EMPTY_STRUCTURED_AGENT_SESSION } from '../../../src/shared/agent-session/structured-agent-session-reducer'
import {
  projectStructuredPermission,
  type StructuredApprovalItem
} from './mobile-structured-agent-prompts'
import type { StructuredAgentSessionMutate } from './mobile-structured-agent-session-rpc'
import { useMobileStructuredPromptResponses } from './use-mobile-structured-prompt-responses'
import { structuredAgentSessionHostSupport } from './mobile-structured-agent-session-host-support'
import { AGENT_SESSION_APPROVAL_NOTES_CAPABILITY } from '../../../src/shared/agent-session/structured-agent-session-surface-capabilities'

const body: AgentJournalApprovalItem = {
  kind: 'approval',
  detail: '',
  title: 'Review plan',
  subject: { kind: 'plan', text: 'Add a test.' },
  acceptsComment: true,
  acceptsPlanEdit: true,
  options: [{ id: 'go', label: 'Proceed' }],
  resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
}
const prompt: StructuredApprovalItem = {
  itemId: 'plan',
  revision: 2,
  sequence: 1,
  observedAt: 1,
  body
}
let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

describe('mobile approval notes compatibility', () => {
  it('does not offer editors to an older host, even with a newer journal', () => {
    expect(projectStructuredPermission(prompt, false)).not.toHaveProperty('acceptsComment')
    expect(projectStructuredPermission(prompt, true)).toMatchObject({
      acceptsComment: true,
      acceptsPlanEdit: true
    })
    expect(structuredAgentSessionHostSupport([]).approvalNotes).toBe(false)
    expect(
      structuredAgentSessionHostSupport([AGENT_SESSION_APPROVAL_NOTES_CAPABILITY]).approvalNotes
    ).toBe(true)
  })

  it.each([false, true])(
    'sends notes only to a capable host: %s',
    async (approvalNotesSupported) => {
      const sent: Record<string, unknown>[] = []
      const mutate: StructuredAgentSessionMutate = async (_method, _fingerprint, fields) => {
        sent.push(fields)
        return { status: 'rejected' }
      }
      let respond: ReturnType<typeof useMobileStructuredPromptResponses> | undefined
      function Probe() {
        respond = useMobileStructuredPromptResponses({
          stateRef: {
            current: { ...EMPTY_STRUCTURED_AGENT_SESSION, status: 'ready', items: [prompt] }
          },
          mutate,
          questionAnswersSupported: true,
          approvalNotesSupported,
          onSendError: vi.fn()
        })
        return null
      }
      act(() => {
        renderer = create(createElement(Probe))
      })
      await act(async () => {
        await respond?.respondPermission('go', {
          comment: 'One file.',
          editedSpecContent: 'Add one test.'
        })
      })
      expect(sent).toEqual(
        approvalNotesSupported
          ? [
              {
                itemId: 'plan',
                expectedRevision: 2,
                optionId: 'go',
                comment: 'One file.',
                editedSpecContent: 'Add one test.'
              }
            ]
          : []
      )
      sent.length = 0
      await act(async () => {
        await respond?.respondPermission('go')
      })
      expect(sent).toEqual([{ itemId: 'plan', expectedRevision: 2, optionId: 'go' }])
    }
  )
})
