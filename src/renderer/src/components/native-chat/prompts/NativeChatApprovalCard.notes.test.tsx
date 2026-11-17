// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { NativeChatApprovalCard } from './NativeChatApprovalCard'
import type { ChatApprovalNotes } from '../../../../../shared/native-chat/input/native-chat-interactive-prompt'

afterEach(cleanup)

function change(label: string, value: string): void {
  const field = screen.queryByRole('textbox', { name: label })
  if (field) {
    fireEvent.change(field, { target: { value } })
  }
}

function click(label: string): void {
  fireEvent.click(screen.queryByRole('button', { name: label }) ?? document.body)
}

function mount() {
  const answers: unknown[] = []
  render(
    <NativeChatApprovalCard
      approval={{
        title: 'Review',
        subject: { kind: 'plan', text: 'Create one file.' },
        acceptsComment: true,
        acceptsPlanEdit: true,
        options: [{ label: 'Proceed', send: 'go' }]
      }}
      onChoose={(option: string, notes?: ChatApprovalNotes) => answers.push([option, notes])}
    />
  )
  return answers
}

it('delivers the comment and edited plan with the selected response', () => {
  const answers = mount()
  change('Comment', 'Keep the scope small.')
  click('Edit plan')
  change('Edited plan', 'Create one file and test it.')
  click('Proceed')
  expect(answers).toEqual([
    ['go', { comment: 'Keep the scope small.', editedSpecContent: 'Create one file and test it.' }]
  ])
})

it('keeps the comment but excludes a discarded plan edit from the response', () => {
  const answers = mount()
  change('Comment', 'Keep the scope small.')
  click('Edit plan')
  change('Edited plan', 'Do not send this.')
  click('Discard edits')
  click('Proceed')
  expect(answers).toEqual([['go', { comment: 'Keep the scope small.' }]])
})
