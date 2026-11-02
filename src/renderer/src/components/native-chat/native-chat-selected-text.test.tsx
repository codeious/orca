// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyNativeChatTranscriptSelection } from './native-chat-selected-text'

const writeClipboardText = vi.fn(async () => {})

function select(from: Node, to = from): void {
  const range = document.createRange()
  range.setStart(from, 0)
  range.setEnd(to, to.textContent?.length ?? 0)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
}

function setup() {
  render(
    <>
      <div
        data-testid="root"
        onKeyDown={(event) => copyNativeChatTranscriptSelection(event, event.currentTarget)}
      >
        <span data-testid="text">selected transcript</span>
        <input data-testid="input" />
      </div>
      <span data-testid="outside">outside</span>
    </>
  )
  const text = screen.getByTestId('text')
  const textNode = text.firstChild
  if (!textNode) {
    throw new Error('Missing transcript text')
  }
  select(textNode)
  return { text, textNode }
}

beforeEach(() => {
  writeClipboardText.mockClear()
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh')
  vi.stubGlobal('api', { ui: { writeClipboardText } })
})
afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('transcript Control+C', () => {
  it('copies only a selection fully inside the chat and claims the key', () => {
    const { text } = setup()
    expect(fireEvent.keyDown(text, { key: 'c', code: 'KeyC', ctrlKey: true })).toBe(false)
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith('selected transcript')
  })

  it('leaves the native copy chord, editable fields, and outside selections alone', () => {
    const { text, textNode } = setup()
    expect(fireEvent.keyDown(text, { key: 'c', code: 'KeyC', metaKey: true })).toBe(true)
    expect(
      fireEvent.keyDown(screen.getByTestId('input'), { key: 'c', code: 'KeyC', ctrlKey: true })
    ).toBe(true)
    const outside = screen.getByTestId('outside').firstChild
    if (!outside) {
      throw new Error('Missing outside text')
    }
    select(textNode, outside)
    expect(fireEvent.keyDown(text, { key: 'c', code: 'KeyC', ctrlKey: true })).toBe(true)
    expect(writeClipboardText).not.toHaveBeenCalled()
  })
})
