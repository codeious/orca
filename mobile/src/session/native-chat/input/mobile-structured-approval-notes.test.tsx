import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_STRUCTURED_AGENT_SESSION } from '../../../../../src/shared/agent-session/structured-agent-session-reducer'
import type { StructuredApprovalItem } from './mobile-structured-agent-prompts'
import type { StructuredAgentSessionMutate } from '../agent-session/mobile-structured-agent-session-rpc'
import { useMobileStructuredPromptResponses } from './use-mobile-structured-prompt-responses'

const prompt: StructuredApprovalItem = {
  itemId: 'plan',
  revision: 2,
  sequence: 1,
  observedAt: 1,
  body: {
    kind: 'approval',
    detail: '',
    title: 'Review plan',
    acceptsComment: true,
    acceptsPlanEdit: true,
    options: [{ id: 'go', label: 'Proceed' }],
    resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
  }
}

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

function mount(approvalNotesSupported: boolean) {
  const sent: Record<string, unknown>[] = []
  const mutate: StructuredAgentSessionMutate = async (_method, _fingerprint, fields) => {
    sent.push(fields)
    return { status: 'rejected' }
  }
  let responses: ReturnType<typeof useMobileStructuredPromptResponses> | undefined
  function Probe() {
    responses = useMobileStructuredPromptResponses({
      stateRef: {
        current: { ...EMPTY_STRUCTURED_AGENT_SESSION, status: 'ready', items: [prompt] }
      },
      mutate,
      questionAnswersSupported: true,
      approvalNotesSupported,
      onSendError: () => {}
    })
    return null
  }
  act(() => {
    renderer = create(createElement(Probe))
  })
  if (!responses) {
    throw new Error('Prompt response hook did not mount')
  }
  return { sent, respond: responses.respondPermission }
}

describe('mobile approval notes compatibility', () => {
  it('sends the complete note payload to a capable host', async () => {
    const { sent, respond } = mount(true)
    await act(async () => {
      await respond('go', { comment: 'One file.', editedSpecContent: 'Add one test.' })
    })
    expect(sent).toEqual([
      {
        itemId: 'plan',
        expectedRevision: 2,
        optionId: 'go',
        comment: 'One file.',
        editedSpecContent: 'Add one test.'
      }
    ])
  })

  it('sends nothing to a host that cannot take notes', async () => {
    const { sent, respond } = mount(false)
    await act(async () => {
      expect(
        await respond('go', { comment: 'One file.', editedSpecContent: 'Add one test.' })
      ).toBe(false)
    })
    expect(sent).toEqual([])
  })
})
