// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { NativeChatQuestionCard } from './NativeChatQuestionCard'

afterEach(cleanup)

it('dismisses an opted-in card without bubbling Escape to turn interruption', () => {
  const actions: string[] = []
  render(
    <div onKeyDown={() => actions.push('interrupt')}>
      <NativeChatQuestionCard
        prompt={{
          questions: [{ question: 'Choose', multiSelect: false, options: [{ label: 'One' }] }]
        }}
        onAnswer={() => {}}
        onCancel={() => actions.push('cancel')}
        cancelOnEscape
        shouldFocus
      />
    </div>
  )
  fireEvent.keyDown(screen.getByRole('button', { name: /One/ }), { key: 'Escape' })
  expect(actions).toEqual(['cancel'])
})
