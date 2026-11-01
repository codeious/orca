// @vitest-environment happy-dom

// A field inside the chat, the composer included, keeps its own copy.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React, { createRef, useRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { NativeChatComposerHandle } from './NativeChatComposer'
import { useStructuredNativeChatPaneCommands } from './use-structured-native-chat-pane-commands'

vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: ReactNode }) => children
  return {
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuShortcut: Pass,
    DropdownMenuSub: Pass,
    DropdownMenuSubContent: Pass,
    DropdownMenuSubTrigger: Pass,
    DropdownMenuTrigger: Pass
  }
})
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/tooltip', () => {
  const Pass = ({ children }: { children?: ReactNode }) => children
  return { Tooltip: Pass, TooltipTrigger: Pass, TooltipContent: () => null }
})
vi.mock('@/components/tab-bar/TabWorkspaceLayoutMenuSection', () => ({
  TabWorkspaceLayoutMenuSection: () => null
}))
vi.mock('@/components/tab-bar/tab-move-to-pane-column', () => ({
  canMoveTabToNewPaneColumn: () => false
}))
vi.mock('@/store', () => ({
  useAppStore: (select: (state: { keybindings: object }) => unknown) => select({ keybindings: {} })
}))

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64)'
const CTRL_C = { key: 'c', code: 'KeyC', ctrlKey: true }
const writeClipboardText = vi.fn()

function Pane({ agent }: { agent: AgentType }): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const commands = useStructuredNativeChatPaneCommands({
    tabId: 'chat-tab',
    groupId: 'group-1',
    isVisible: true,
    rootRef,
    composerRef: createRef<NativeChatComposerHandle>(),
    questionAnswerInputRef: createRef<HTMLInputElement>(),
    sessionId: '4a1f6c2e-8b3d-4e7a-9c15-0d2b6e8f1a37',
    target: { kind: 'environment', environmentId: 'env_1' },
    agent
  })
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-testid="root"
      onKeyDownCapture={commands.onKeyDownCapture}
    >
      <p data-testid="reply">The agent said hello there</p>
      <div contentEditable="true" role="textbox" data-testid="composer">
        draft text
      </div>
    </div>
  )
}

function selectText(element: HTMLElement, from: number, to: number): void {
  const text = element.firstChild
  if (!(text instanceof Text)) {
    throw new Error('expected a text node to select in')
  }
  const range = document.createRange()
  range.setStart(text, from)
  range.setEnd(text, to)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Presses Ctrl+C on the chat root and says whether the key was kept from the browser. */
function pressOn(testId: string): boolean {
  return !fireEvent.keyDown(screen.getByTestId(testId), CTRL_C)
}

beforeEach(() => {
  writeClipboardText.mockReset().mockResolvedValue(undefined)
  Object.assign(window, { api: { ui: { writeClipboardText } } })
})

afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
})

describe.each([
  ['macOS', MAC],
  ['Windows', WINDOWS],
  ['Linux', LINUX]
])('Ctrl+C in a Droid chat on %s', (_os, ua) => {
  beforeEach(() => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  })

  it('copies the transcript selection', () => {
    render(<Pane agent="droid" />)
    selectText(screen.getByTestId('reply'), 4, 9)

    expect(pressOn('root')).toBe(true)
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith('agent')
  })

  it('does nothing with no selection', () => {
    render(<Pane agent="droid" />)

    expect(pressOn('root')).toBe(false)
    expect(writeClipboardText).not.toHaveBeenCalled()
  })

  it('leaves the composer to copy its own selection', () => {
    render(<Pane agent="droid" />)
    selectText(screen.getByTestId('composer'), 0, 5)

    expect(pressOn('composer')).toBe(false)
    expect(writeClipboardText).not.toHaveBeenCalled()
  })
})

describe('Ctrl+C with another modifier held', () => {
  it.each([
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['Cmd', { metaKey: true, ctrlKey: false }]
  ])('does not copy on %s+C', (_name, extra) => {
    render(<Pane agent="droid" />)
    selectText(screen.getByTestId('reply'), 4, 9)

    fireEvent.keyDown(screen.getByTestId('root'), { ...CTRL_C, ...extra })
    expect(writeClipboardText).not.toHaveBeenCalled()
  })
})

describe.each(['claude', 'codex', 'pi', 'grok', 'opencode', 'omp'] as const)(
  'Ctrl+C in a %s chat',
  (agent) => {
    it('keeps today\u2019s behavior: the key is left to the browser', () => {
      render(<Pane agent={agent} />)
      selectText(screen.getByTestId('reply'), 4, 9)

      expect(pressOn('root')).toBe(false)
      expect(writeClipboardText).not.toHaveBeenCalled()
    })
  }
)
