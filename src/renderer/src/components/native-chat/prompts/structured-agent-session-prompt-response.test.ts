import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notesSupported: vi.fn<() => Promise<boolean>>(),
  answersSupported: vi.fn<() => Promise<boolean>>(),
  mutate: vi.fn()
}))

vi.mock('@/runtime/native-chat/host-capabilities/structured-agent-session-host-support', () => ({
  supportsStructuredAgentSessionApprovalNotes: mocks.notesSupported,
  supportsStructuredAgentSessionQuestionAnswers: mocks.answersSupported
}))

import type { StructuredPromptItem } from '../../../../../shared/agent-session/view/structured-agent-session-message-projection'
import { respondToStructuredAgentSessionPrompt } from './structured-agent-session-prompt-response'

const plan: StructuredPromptItem = {
  itemId: 'plan-1',
  revision: 4,
  sequence: 4,
  observedAt: 4,
  body: {
    kind: 'approval',
    title: 'Review plan',
    detail: null,
    acceptsComment: true,
    acceptsPlanEdit: true,
    options: [{ id: 'proceed_once', label: 'Proceed' }],
    resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
  }
}

function respond(
  response: Parameters<typeof respondToStructuredAgentSessionPrompt>[0]['response']
) {
  return respondToStructuredAgentSessionPrompt({
    item: plan,
    response,
    action: { target: { kind: 'local' }, mutate: mocks.mutate, write: vi.fn() }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mutate.mockResolvedValue({ ok: true })
})

describe('answering an approval with notes', () => {
  it('sends the exact comment and edited plan to a capable host', async () => {
    mocks.notesSupported.mockResolvedValue(true)
    await respond({
      kind: 'option',
      optionId: 'proceed_once',
      comment: 'One file only.',
      editedSpecContent: '1. Write it, once.'
    })
    expect(mocks.mutate).toHaveBeenCalledWith(
      'agentSession.respondToApproval',
      'agentSession.respondTo:approval',
      {
        itemId: 'plan-1',
        expectedRevision: 4,
        optionId: 'proceed_once',
        comment: 'One file only.',
        editedSpecContent: '1. Write it, once.'
      }
    )
  })

  it('sends nothing rather than silently discard a note on an older host', async () => {
    mocks.notesSupported.mockResolvedValue(false)
    expect(
      await respond({ kind: 'option', optionId: 'proceed_once', comment: 'One file only.' })
    ).toBeNull()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
})
