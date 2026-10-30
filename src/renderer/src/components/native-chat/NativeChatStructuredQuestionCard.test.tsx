// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeChatStructuredQuestionCard } from './NativeChatStructuredQuestionCard'
import type { AgentJournalQuestion } from '../../../../shared/agent-session-journal-types'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(question: AgentJournalQuestion, cancelOnEscape?: boolean) {
  const onAnswer = vi.fn()
  const onCancel = vi.fn()
  act(() =>
    root.render(
      <NativeChatStructuredQuestionCard
        questions={[question]}
        onAnswer={onAnswer}
        onCancel={onCancel}
        {...(cancelOnEscape === undefined ? {} : { cancelOnEscape })}
      />
    )
  )
  return { onAnswer, onCancel }
}
function rows(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
}
function pressedLabels(): string[] {
  return rows()
    .filter((row) => row.getAttribute('aria-pressed') === 'true')
    .map((row) => row.textContent ?? '')
}
function click(node: Element | undefined): void {
  if (!node) {
    throw new Error('Missing node to click')
  }
  act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}
function typeSearch(value: string): void {
  const search = container.querySelector('input')
  if (!search) {
    throw new Error('Missing search field')
  }
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setValue?.call(search, value)
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function pressEscape(): void {
  const target = container.querySelector('button')
  act(() =>
    target?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
  )
}
function submit(): void {
  const button = [...container.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === 'Submit'
  )
  if (!button) {
    throw new Error('Missing Submit button')
  }
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

const input: AgentJournalQuestion = {
  id: 'text',
  question: 'Enter text',
  options: [],
  multiSelect: false,
  freeTextQuestionId: 'text',
  freeTextInput: { allowEmpty: true, placeholder: 'Provider placeholder' }
}

describe('structured extension question cards', () => {
  it('submits an empty input as an answer', () => {
    const { onAnswer } = render(input)
    expect(container.querySelector('input')?.placeholder).toBe('Provider placeholder')
    submit()
    expect(onAnswer).toHaveBeenCalledWith({
      kind: 'answers',
      answers: [{ questionId: 'text', optionIds: [], other: '' }]
    })
  })

  it('renders the editor prefill and preserves whitespace, newlines and Unicode separators', () => {
    const text = ' first\nsecond\u2028third\u2029fourth '
    const { onAnswer } = render({
      ...input,
      freeTextInput: { allowEmpty: true, multiline: true, initialValue: text }
    })
    expect(container.querySelector('textarea')?.value).toBe(text)
    expect(container.querySelector('input')).toBeNull()
    submit()
    expect(onAnswer).toHaveBeenCalledWith({
      kind: 'answers',
      answers: [{ questionId: 'text', optionIds: [], other: text }]
    })
  })

  it('submits the text the user edited in the editor, not its prefill', () => {
    const { onAnswer } = render({
      ...input,
      freeTextInput: { allowEmpty: true, multiline: true, initialValue: 'prefill' }
    })
    const textarea = container.querySelector('textarea')
    if (!textarea) {
      throw new Error('Missing editor textarea')
    }
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    act(() => {
      setValue?.call(textarea, 'prefill, then edited\nsecond line')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    submit()
    expect(onAnswer).toHaveBeenCalledWith({
      kind: 'answers',
      answers: [{ questionId: 'text', optionIds: [], other: 'prefill, then edited\nsecond line' }]
    })
  })

  it('keeps legacy empty input disabled', () => {
    const { onAnswer } = render({ ...input, freeTextInput: undefined })
    expect(
      [...container.querySelectorAll('button')].some(
        (button) => button.textContent?.trim() === 'Submit'
      )
    ).toBe(false)
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('keeps select-only questions limited to their offered values', () => {
    const { onAnswer } = render({
      id: 'q1',
      question: 'Select',
      options: [{ id: 'opaque-index-0', label: 'Choice' }],
      multiSelect: false
    })
    expect(container.querySelector('input')).toBeNull()
    const button = container.querySelector('button[aria-pressed]')
    if (!button) {
      throw new Error('Missing choice button')
    }
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    submit()
    expect(onAnswer).toHaveBeenCalledWith({
      kind: 'answers',
      answers: [{ questionId: 'q1', optionIds: ['opaque-index-0'] }]
    })
  })
})

// A pick-options request as the journal holds it: one question, no typed answer.
const picker: AgentJournalQuestion = {
  id: 'q1',
  question: 'Pick a channel',
  multiSelect: true,
  options: [
    { id: 'o1', label: 'Alpha', description: 'first' },
    { id: 'o2', label: 'Beta' },
    { id: 'o3', label: 'Gamma' }
  ]
}

describe('structured pick-options cards', () => {
  it('opens with nothing chosen, no search and no note when the request carried none', () => {
    const { onAnswer } = render(picker)

    expect(pressedLabels()).toEqual([])
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('[data-testid="native-chat-question-card-note"]')).toBeNull()
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('opens on the rows the request preselected, and sends them unchanged', () => {
    const { onAnswer } = render({ ...picker, preselectedOptionIds: ['o1', 'o3'] })

    expect(rows().map((row) => row.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'true'])
    submit()
    expect(onAnswer).toHaveBeenCalledWith({
      kind: 'answers',
      answers: [{ questionId: 'q1', optionIds: ['o1', 'o3'] }]
    })
  })

  it('leaves out a preselected row the person deselects', () => {
    const { onAnswer } = render({ ...picker, preselectedOptionIds: ['o1', 'o3'] })

    click(rows()[0])
    submit()

    expect(onAnswer).toHaveBeenCalledWith({
      kind: 'answers',
      answers: [{ questionId: 'q1', optionIds: ['o3'] }]
    })
  })

  it('starts on the search the request named, and narrows the rows to the rows it matches', () => {
    render({ ...picker, initialSearch: 'ALP' })

    expect(container.querySelector('input')?.value).toBe('ALP')
    expect(rows().map((row) => row.textContent)).toEqual(['1Alphafirst'])

    typeSearch('first')
    expect(rows().map((row) => row.textContent)).toEqual(['1Alphafirst'])
    typeSearch('')
    expect(rows()).toHaveLength(3)
  })

  it('sends a row picked after filtering, and a row the filter hides only if it was chosen before', () => {
    const { onAnswer } = render({
      ...picker,
      preselectedOptionIds: ['o2'],
      initialSearch: 'alp'
    })

    click(rows()[0])
    submit()

    expect(onAnswer).toHaveBeenCalledWith({
      kind: 'answers',
      answers: [{ questionId: 'q1', optionIds: ['o1', 'o2'] }]
    })
  })

  it('does not send a hidden row that was never chosen', () => {
    const { onAnswer } = render({ ...picker, initialSearch: 'alp' })

    click(rows()[0])
    submit()

    expect(onAnswer).toHaveBeenCalledWith({
      kind: 'answers',
      answers: [{ questionId: 'q1', optionIds: ['o1'] }]
    })
  })

  it('shows the note the request carried under the title', () => {
    render({ ...picker, description: 'Invite the bot first' })

    expect(
      container.querySelector('[data-testid="native-chat-question-card-note"]')?.textContent
    ).toBe('Invite the bot first')
  })

  it('cancels on Escape when the host says Escape closes this card', () => {
    const { onAnswer, onCancel } = render(picker, true)

    pressEscape()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('keeps Escape for a card that takes a typed answer, so Escape never drops the draft', () => {
    const { onCancel } = render(input, true)

    act(() =>
      container
        .querySelector('input')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        )
    )

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('leaves Escape alone by default, so Claude, Codex, pi and ACP cards keep today’s keys', () => {
    const { onCancel } = render(picker)

    pressEscape()

    expect(onCancel).not.toHaveBeenCalled()
  })
})
