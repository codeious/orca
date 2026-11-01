// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  useNativeChatComposerError,
  useNativeChatComposerNotice
} from './use-native-chat-composer-notice'
import type { NativeChatComposerNotice } from './native-chat-composer-notice'

const CHAT_ERROR: NativeChatComposerNotice = {
  key: 'composer-error',
  kind: 'error',
  text: 'sonnet-9 is not an available model for this chat session.'
}

const NO_CAUSES = { working: false, prompt: false, background: false, sending: false, retry: false }

describe('useNativeChatComposerError', () => {
  it('keeps the line a host answered as information, until the next report clears it', () => {
    const { result } = renderHook(() => useNativeChatComposerError(NO_CAUSES))
    act(() => result.current.reportComposerError('the key list', { kind: 'info' }))
    expect(result.current.composerError).toMatchObject({ text: 'the key list', kind: 'info' })
    act(() => result.current.reportComposerError(null))
    expect(result.current.composerError).toBeNull()
  })

  it('dismisses an informational line like any other', () => {
    const { result } = renderHook(() => useNativeChatComposerError(NO_CAUSES))
    act(() => result.current.reportComposerError('the key list', { kind: 'info' }))
    act(() => result.current.composerError?.onDismiss())
    expect(result.current.composerError).toBeNull()
  })

  describe('an informational line with an action beside it', () => {
    it('shows the action, runs it once, and takes the line away so it cannot run twice', () => {
      const onClick = vi.fn()
      const { result } = renderHook(() => useNativeChatComposerError(NO_CAUSES))
      act(() =>
        result.current.reportComposerError('Forked.', {
          kind: 'info',
          action: { label: 'Open fork', onClick }
        })
      )
      expect(result.current.composerError).toMatchObject({
        text: 'Forked.',
        kind: 'info',
        action: { label: 'Open fork' }
      })

      act(() => result.current.composerError?.action?.onClick())

      expect(onClick).toHaveBeenCalledOnce()
      expect(result.current.composerError).toBeNull()
    })

    it('leaves the line when the next report replaces it', () => {
      const { result } = renderHook(() => useNativeChatComposerError(NO_CAUSES))
      act(() =>
        result.current.reportComposerError('Forked.', {
          kind: 'info',
          action: { label: 'Open fork', onClick: vi.fn() }
        })
      )
      act(() => result.current.reportComposerError('the key list', { kind: 'info' }))
      expect(result.current.composerError).not.toHaveProperty('action')
    })

    it('gives a line with no action no action', () => {
      const { result } = renderHook(() => useNativeChatComposerError(NO_CAUSES))
      act(() => result.current.reportComposerError('the key list', { kind: 'info' }))
      expect(result.current.composerError).not.toHaveProperty('action')
    })
  })

  it('gives a line with no kind no kind, so it stays the error it always was', () => {
    const { result } = renderHook(() => useNativeChatComposerError(NO_CAUSES))
    act(() => result.current.reportComposerError('Could not apply effort high.'))
    expect(result.current.composerError).toMatchObject({ text: 'Could not apply effort high.' })
    expect(result.current.composerError).not.toHaveProperty('kind')
  })

  it('replaces an error with the host answer that follows it', () => {
    const { result } = renderHook(() => useNativeChatComposerError(NO_CAUSES))
    act(() => result.current.reportComposerError('Your message was not sent.'))
    act(() => result.current.reportComposerError('the key list', { kind: 'info' }))
    expect(result.current.composerError).toMatchObject({ text: 'the key list', kind: 'info' })
  })

  it('replaces an informational line with the error that follows it', () => {
    const { result } = renderHook(() => useNativeChatComposerError(NO_CAUSES))
    act(() => result.current.reportComposerError('the key list', { kind: 'info' }))
    act(() => result.current.reportComposerError('Your message was not sent.'))
    expect(result.current.composerError).toMatchObject({ text: 'Your message was not sent.' })
    expect(result.current.composerError).not.toHaveProperty('kind')
  })
})

describe('useNativeChatComposerNotice', () => {
  it("adds the composer's own notice after the chat's, each under its own key", () => {
    const chatNotices = [CHAT_ERROR]
    const { result } = renderHook(() => useNativeChatComposerNotice(chatNotices))
    act(() => result.current.setNotice('Paste failed.', 'sftp down'))
    expect(result.current.notices.map((notice) => notice.key)).toEqual([
      'composer-error',
      'composer-attachment'
    ])
    expect(result.current.notices[1]).toMatchObject({
      text: 'Paste failed.',
      errorText: 'sftp down'
    })
  })

  it("clears its own notice on dismiss and leaves the chat's", () => {
    const chatNotices = [CHAT_ERROR]
    const { result } = renderHook(() => useNativeChatComposerNotice(chatNotices))
    act(() => result.current.setNotice('Worktree not ready.'))
    act(() => result.current.notices[1]?.onDismiss?.())
    expect(result.current.notices).toEqual([CHAT_ERROR])
  })
})
