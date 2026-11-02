import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notesSupported: vi.fn<() => Promise<boolean>>(),
  answersSupported: vi.fn<() => Promise<boolean>>(),
  mutate: vi.fn()
}))

vi.mock('@/runtime/structured-agent-session-client', () => ({
  supportsStructuredAgentSessionApprovalNotes: mocks.notesSupported,
  supportsStructuredAgentSessionQuestionAnswers: mocks.answersSupported
}))

import type { StructuredPromptItem } from '../../../../shared/agent-session/view/structured-agent-session-message-projection'
import { respondToStructuredAgentSessionPrompt } from './structured-agent-session-prompt-response'

const target = { kind: 'local' } as const

const plan: StructuredPromptItem = {
  itemId: 'plan-1',
  revision: 4,
  sequence: 4,
  observedAt: 4,
  body: {
    kind: 'approval',
    title: 'Review proposed plan',
    detail: null,
    acceptsComment: true,
    acceptsPlanEdit: true,
    subject: { kind: 'plan', text: '1. Write it.' },
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
    action: { target, mutate: mocks.mutate, write: vi.fn() }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mutate.mockResolvedValue({ ok: true })
})

describe('answering an approval', () => {
  it('sends the option alone, and asks the host nothing, when no note is typed', async () => {
    await respond({ kind: 'option', optionId: 'proceed_once' })

    expect(mocks.notesSupported).not.toHaveBeenCalled()
    expect(mocks.mutate).toHaveBeenCalledWith(
      'agentSession.respondToApproval',
      'agentSession.respondTo:approval',
      { itemId: 'plan-1', expectedRevision: 4, optionId: 'proceed_once' }
    )
  })

  it('sends a comment and an edited plan to a host that takes them', async () => {
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

  it('sends only the field that was typed', async () => {
    mocks.notesSupported.mockResolvedValue(true)

    await respond({ kind: 'option', optionId: 'proceed_once', comment: 'One file only.' })

    expect(mocks.mutate.mock.calls[0]?.[2]).toEqual({
      itemId: 'plan-1',
      expectedRevision: 4,
      optionId: 'proceed_once',
      comment: 'One file only.'
    })
  })

  it('answers nothing, rather than answer without the note, on a host that cannot take it', async () => {
    mocks.notesSupported.mockResolvedValue(false)

    const result = await respond({
      kind: 'option',
      optionId: 'proceed_once',
      comment: 'One file only.'
    })

    expect(result).toBeNull()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
})
