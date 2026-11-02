// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDroidComposerFocusEvents } from './use-droid-composer-focus-mirror'

const setDroidComposerFocused = vi.fn()

function Composer({ agent }: { agent: string }): React.JSX.Element {
  const focus = useDroidComposerFocusEvents(agent, {})
  return <input data-testid="composer" {...focus} />
}

beforeEach(() => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh')
  setDroidComposerFocused.mockReset()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { ui: { setDroidComposerFocused } }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useDroidComposerFocusMirror', () => {
  it.each(['Windows NT 10.0', 'X11; Linux'])('never claims main-window chords on %s', (ua) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
    const { unmount } = render(<Composer agent="droid" />)
    fireEvent.focus(screen.getByTestId('composer'))
    fireEvent.blur(screen.getByTestId('composer'))
    unmount()
    expect(setDroidComposerFocused).not.toHaveBeenCalled()
  })

  it('restores claims when the window regains focus without an input focus event', () => {
    render(<Composer agent="droid" />)
    fireEvent.focus(screen.getByTestId('composer'))
    fireEvent(window, new Event('blur'))
    expect(setDroidComposerFocused).toHaveBeenLastCalledWith(false)
    fireEvent(window, new Event('focus'))
    expect(setDroidComposerFocused).toHaveBeenLastCalledWith(true)
    fireEvent.blur(screen.getByTestId('composer'))
    setDroidComposerFocused.mockClear()
    fireEvent(window, new Event('focus'))
    expect(setDroidComposerFocused).not.toHaveBeenCalled()
  })

  it('reports focus and blur of a Droid composer to the main process', () => {
    render(<Composer agent="droid" />)
    fireEvent.focus(screen.getByTestId('composer'))
    expect(setDroidComposerFocused).toHaveBeenLastCalledWith(true)
    fireEvent.blur(screen.getByTestId('composer'))
    expect(setDroidComposerFocused).toHaveBeenLastCalledWith(false)
    expect(setDroidComposerFocused).toHaveBeenCalledTimes(2)
  })

  it('hands the keys back when a focused Droid composer unmounts', () => {
    const { unmount } = render(<Composer agent="droid" />)
    fireEvent.focus(screen.getByTestId('composer'))
    setDroidComposerFocused.mockClear()
    unmount()
    expect(setDroidComposerFocused).toHaveBeenCalledTimes(1)
    expect(setDroidComposerFocused).toHaveBeenLastCalledWith(false)
  })

  it('hands the keys back when the chat stops being Droid while focused', () => {
    const { rerender } = render(<Composer agent="droid" />)
    fireEvent.focus(screen.getByTestId('composer'))
    setDroidComposerFocused.mockClear()
    rerender(<Composer agent="claude" />)
    expect(setDroidComposerFocused).toHaveBeenCalledTimes(1)
    expect(setDroidComposerFocused).toHaveBeenLastCalledWith(false)
  })

  it('says nothing when a composer that never held focus unmounts', () => {
    const { unmount } = render(<Composer agent="droid" />)
    unmount()
    expect(setDroidComposerFocused).not.toHaveBeenCalled()
  })

  it('says nothing after a blur already handed the keys back', () => {
    const { unmount } = render(<Composer agent="droid" />)
    fireEvent.focus(screen.getByTestId('composer'))
    fireEvent.blur(screen.getByTestId('composer'))
    setDroidComposerFocused.mockClear()
    unmount()
    expect(setDroidComposerFocused).not.toHaveBeenCalled()
  })

  it.each(['claude', 'codex', 'pi', 'grok', 'opencode', 'omp'])(
    'never reports focus of a %s composer',
    (agent) => {
      const { unmount } = render(<Composer agent={agent} />)
      fireEvent.focus(screen.getByTestId('composer'))
      fireEvent.blur(screen.getByTestId('composer'))
      fireEvent.focus(screen.getByTestId('composer'))
      unmount()
      expect(setDroidComposerFocused).not.toHaveBeenCalled()
    }
  )
})
