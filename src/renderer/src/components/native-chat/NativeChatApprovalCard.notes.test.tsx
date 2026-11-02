// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalApprovalItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import { NativeChatApprovalCard } from './NativeChatApprovalCard'
import {
  chatApprovalFromJournal,
  type ChatApproval
} from '../../../../shared/native-chat/input/native-chat-interactive-prompt'

afterEach(cleanup)

const PLAN = '1. Create plan-probe.txt with "hello".'

// The nine options Droid sent in the capture; the card draws the ones that survive the host.
const OFFERED = [
  'proceed_once',
  'proceed_auto_run_low',
  'proceed_new_session',
  'proceed_new_session_high',
  'cancel'
] as const

function planApproval(extra: Partial<ChatApproval> = {}): ChatApproval {
  return {
    title: 'Review proposed plan',
    subject: { kind: 'plan', text: PLAN },
    options: OFFERED.map((send) => ({ label: send, send })),
    ...extra
  }
}

function renderCard(approval: ChatApproval) {
  const onChoose = vi.fn()
  render(<NativeChatApprovalCard approval={approval} onChoose={onChoose} />)
  return onChoose
}

const commentBox = (): HTMLTextAreaElement =>
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Comment' })

describe('a Spec plan card that takes a comment and an edited plan', () => {
  const TAKES_BOTH = { acceptsComment: true, acceptsPlanEdit: true }

  it('draws every option it was given, under the plan', () => {
    renderCard(planApproval(TAKES_BOTH))

    for (const option of OFFERED) {
      expect(screen.getByRole('button', { name: option })).toBeTruthy()
    }
    expect(document.querySelector('[data-native-chat-approval-plan]')?.textContent).toContain(
      'plan-probe.txt'
    )
  })

  it('chooses an option alone when nothing was typed', () => {
    const onChoose = renderCard(planApproval(TAKES_BOTH))

    fireEvent.click(screen.getByRole('button', { name: 'proceed_new_session' }))

    expect(onChoose).toHaveBeenCalledExactlyOnceWith('proceed_new_session')
  })

  it('sends the comment with the option chosen, even a cancel', () => {
    const onChoose = renderCard(planApproval(TAKES_BOTH))

    fireEvent.change(commentBox(), { target: { value: 'Keep it to one file.' } })
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(onChoose).toHaveBeenCalledExactlyOnceWith('cancel', { comment: 'Keep it to one file.' })
  })

  it('treats a blank comment as none', () => {
    const onChoose = renderCard(planApproval(TAKES_BOTH))

    fireEvent.change(commentBox(), { target: { value: '  \n ' } })
    fireEvent.click(screen.getByRole('button', { name: 'proceed_once' }))

    expect(onChoose).toHaveBeenCalledExactlyOnceWith('proceed_once')
  })

  it('opens the plan for editing and sends the edited text with the option chosen', () => {
    const onChoose = renderCard(planApproval(TAKES_BOTH))

    fireEvent.click(screen.getByRole('button', { name: 'Edit plan' }))
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edited plan' })
    expect(editor.value).toBe(PLAN)
    fireEvent.change(editor, { target: { value: `${PLAN}\n2. Print it.` } })
    fireEvent.click(screen.getByRole('button', { name: 'proceed_auto_run_low' }))

    expect(onChoose).toHaveBeenCalledExactlyOnceWith('proceed_auto_run_low', {
      editedSpecContent: `${PLAN}\n2. Print it.`
    })
  })

  it('sends a comment and an edit together', () => {
    const onChoose = renderCard(planApproval(TAKES_BOTH))

    fireEvent.change(commentBox(), { target: { value: 'Added step 2.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit plan' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edited plan' }), {
      target: { value: 'Only this.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'proceed_new_session_high' }))

    expect(onChoose).toHaveBeenCalledExactlyOnceWith('proceed_new_session_high', {
      comment: 'Added step 2.',
      editedSpecContent: 'Only this.'
    })
  })

  it('sends no edit when the plan is opened and left as it was, or emptied', () => {
    const onChoose = renderCard(planApproval(TAKES_BOTH))

    fireEvent.click(screen.getByRole('button', { name: 'Edit plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'proceed_once' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edited plan' }), {
      target: { value: '   ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'proceed_once' }))

    expect(onChoose).toHaveBeenNthCalledWith(1, 'proceed_once')
    expect(onChoose).toHaveBeenNthCalledWith(2, 'proceed_once')
  })

  it('drops the edits when they are discarded, and shows the plan again', () => {
    const onChoose = renderCard(planApproval(TAKES_BOTH))

    fireEvent.click(screen.getByRole('button', { name: 'Edit plan' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edited plan' }), {
      target: { value: 'Changed.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Discard edits' }))
    fireEvent.click(screen.getByRole('button', { name: 'proceed_once' }))

    expect(screen.queryByRole('textbox', { name: 'Edited plan' })).toBeNull()
    expect(document.querySelector('[data-native-chat-approval-plan]')?.textContent).toContain(
      'plan-probe.txt'
    )
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('proceed_once')
  })
})

describe('a plan card from an agent that takes no note', () => {
  it('draws no comment box and no edit-plan action', () => {
    renderCard(planApproval())

    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit plan' })).toBeNull()
  })

  it('takes a comment but offers no plan edit when only the comment is accepted', () => {
    renderCard(planApproval({ acceptsComment: true }))

    expect(commentBox()).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit plan' })).toBeNull()
  })

  it('offers no plan edit for an approval that has no plan, whatever the flag says', () => {
    renderCard({
      title: 'Allow command?',
      detail: 'pnpm test',
      acceptsPlanEdit: true,
      options: [{ label: 'Allow', send: 'allow' }]
    })

    expect(screen.queryByRole('button', { name: 'Edit plan' })).toBeNull()
  })
})

describe('the flags a journal approval carries', () => {
  const body = (extra: Partial<AgentJournalApprovalItem>): AgentJournalApprovalItem => ({
    kind: 'approval',
    title: 'Review proposed plan',
    detail: null,
    options: [{ id: 'proceed_once', label: 'Proceed' }],
    resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null },
    ...extra
  })

  it('reach the card, and are absent on a row that has none', () => {
    expect(
      chatApprovalFromJournal(body({ acceptsComment: true, acceptsPlanEdit: true }))
    ).toMatchObject({
      acceptsComment: true,
      acceptsPlanEdit: true
    })
    const plain = chatApprovalFromJournal(body({}))
    expect('acceptsComment' in plain).toBe(false)
    expect('acceptsPlanEdit' in plain).toBe(false)
  })
})
