// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeChatQuestionCard } from './NativeChatQuestionCard'

afterEach(cleanup)
const prompt = {
  questions: [{ question: 'Choose', multiSelect: false, options: [{ label: 'One' }] }]
}

describe('question Escape ownership', () => {
  it('dismisses an opted-in focused card once, without bubbling to turn interruption', () => {
    const cancel = vi.fn(),
      interrupt = vi.fn()
    render(
      <div onKeyDown={interrupt}>
        <NativeChatQuestionCard
          prompt={prompt}
          onAnswer={vi.fn()}
          onCancel={cancel}
          cancelOnEscape
          shouldFocus
        />
      </div>
    )
    expect(screen.getByRole('group').contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(screen.getByRole('button', { name: /One/ }), { key: 'Escape' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(interrupt).not.toHaveBeenCalled()
  })

  it('keeps typed answers and pending submissions intact on Escape', () => {
    const cancel = vi.fn()
    const { rerender } = render(
      <NativeChatQuestionCard prompt={prompt} onAnswer={vi.fn()} onCancel={cancel} cancelOnEscape />
    )
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    rerender(
      <NativeChatQuestionCard
        prompt={prompt}
        onAnswer={vi.fn()}
        onCancel={cancel}
        cancelOnEscape
        isSubmitting
      />
    )
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Escape' })
    expect(cancel).not.toHaveBeenCalled()
  })
})
