import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () =>
  (await import('./createMainWindow-test-harness')).electronModuleMock()
)
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./macos-tahoe-release', async () =>
  (await import('./createMainWindow-test-harness')).macosTahoeReleaseMock()
)
vi.mock('../app-icon', async () => (await import('./createMainWindow-test-harness')).appIconMock())
vi.mock('../browser/browser-manager', async () =>
  (await import('./createMainWindow-test-harness')).browserManagerMock()
)

import { createMainWindow } from './createMainWindow'
import { ipcMain } from 'electron'
import { resetExpectedTeardownStateForTest } from '../crash-reporting/expected-teardown-state'
import {
  browserWindowMock,
  resetMainWindowMocks,
  withPlatform
} from './createMainWindow-test-harness'

type Handler = (...args: any[]) => void

type OpenedWindow = {
  webContents: { send: ReturnType<typeof vi.fn> }
  /** The renderer reporting Droid composer focus over IPC; `sender` defaults to the main window. */
  setDroidComposerFocused: (focused: unknown, sender?: unknown) => void
  setMarkdownEditorFocused: (focused: boolean) => void
  setTerminalInputFocused: (focused: boolean) => void
  /** Fires every listener registered for the event, as Electron does. */
  emitWindow: (event: string, ...args: unknown[]) => void
  emitWebContents: (event: string, ...args: unknown[]) => void
  /** A keyDown through before-input-event; returns whether main consumed it. */
  press: (input: Record<string, unknown>) => { consumed: boolean; sent: string[] }
}

function openWindow(controlBindings = false): OpenedWindow {
  const windowHandlers: Record<string, Handler[]> = {}
  const webContentsHandlers: Record<string, Handler[]> = {}
  const record =
    (into: Record<string, Handler[]>) =>
    (event: string, handler: Handler): void => {
      ;(into[event] ??= []).push(handler)
    }
  const webContents = {
    id: 143,
    getURL: vi.fn(() => 'file:///opt/orca/renderer/index.html'),
    isDestroyed: vi.fn(() => false),
    isLoadingMainFrame: vi.fn(() => false),
    mainFrame: {},
    on: vi.fn(record(webContentsHandlers)),
    setZoomLevel: vi.fn(),
    setBackgroundThrottling: vi.fn(),
    invalidate: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    setWebRTCIPHandlingPolicy: vi.fn(),
    send: vi.fn(),
    isDevToolsOpened: vi.fn(),
    openDevTools: vi.fn(),
    closeDevTools: vi.fn()
  }
  const browserWindowInstance = {
    webContents,
    on: vi.fn(record(windowHandlers)),
    isDestroyed: vi.fn(() => false),
    isMaximized: vi.fn(() => true),
    isFullScreen: vi.fn(() => false),
    getSize: vi.fn(() => [1200, 800]),
    setSize: vi.fn(),
    maximize: vi.fn(),
    show: vi.fn(),
    loadFile: vi.fn(() => Promise.resolve()),
    loadURL: vi.fn(() => Promise.resolve())
  }
  browserWindowMock.mockImplementation(function () {
    return browserWindowInstance
  })

  createMainWindow(null, {
    getKeybindings: () =>
      controlBindings ? { 'sidebar.right.toggle': ['Ctrl+L'], 'workspace.create': ['Ctrl+N'] } : {}
  })

  const listener = (channel: string): Handler => {
    // A test may open two windows; the newest registration belongs to the window just opened.
    const registered = vi.mocked(ipcMain.on).mock.calls.findLast(([name]) => name === channel)?.[1]
    if (typeof registered !== 'function') {
      throw new Error(`${channel} listener was never registered`)
    }
    return registered
  }
  const setDroid = listener('ui:setDroidComposerFocused')
  const setMarkdown = listener('ui:setMarkdownEditorFocused')
  const setTerminal = listener('ui:setTerminalInputFocused')
  return {
    webContents,
    setDroidComposerFocused: (focused, sender = webContents) => setDroid({ sender }, focused),
    setMarkdownEditorFocused: (focused) => setMarkdown({ sender: webContents }, focused),
    setTerminalInputFocused: (focused) => setTerminal({ sender: webContents }, focused),
    emitWindow: (event, ...args) => windowHandlers[event]?.forEach((handler) => handler(...args)),
    emitWebContents: (event, ...args) =>
      webContentsHandlers[event]?.forEach((handler) => handler(...args)),
    press: (input) => {
      webContents.send.mockClear()
      const preventDefault = vi.fn()
      webContentsHandlers['before-input-event']?.forEach((handler) =>
        handler({ preventDefault }, { type: 'keyDown', alt: false, shift: false, ...input })
      )
      return {
        consumed: preventDefault.mock.calls.length > 0,
        sent: webContents.send.mock.calls.map(([channel]) => String(channel))
      }
    }
  }
}

const ctrlL = { key: 'l', code: 'KeyL', control: true, meta: false }
const ctrlN = { key: 'n', code: 'KeyN', control: true, meta: false }
const cmdL = { key: 'l', code: 'KeyL', control: false, meta: true }
const cmdN = { key: 'n', code: 'KeyN', control: false, meta: true }

const TOGGLE_RIGHT_SIDEBAR = ['ui:toggleRightSidebar']
const CREATE_WORKTREE = ['ui:openNewWorkspace']

/** Each way the Droid composer stops holding focus; every one must hand Ctrl+L and Ctrl+N back. */
const CLEAR_EVENTS: readonly [string, (window: OpenedWindow) => void][] = [
  ['composer blur', (window) => window.setDroidComposerFocused(false)],
  // The renderer's unmount cleanup reports the same IPC; the hook test pins that it does.
  ['composer unmount', (window) => window.setDroidComposerFocused(false)],
  ['window blur', (window) => window.emitWindow('blur')],
  [
    'renderer reload',
    (window) =>
      window.emitWebContents(
        'did-start-navigation',
        {},
        'file:///opt/orca/renderer/index.html?reload=1',
        false,
        true
      )
  ],
  ['renderer crash', (window) => window.emitWebContents('render-process-gone')],
  ['webContents teardown', (window) => window.emitWebContents('destroyed')]
]

describe('createMainWindow composer shortcut ownership', () => {
  beforeEach(() => {
    resetMainWindowMocks()
    resetExpectedTeardownStateForTest()
    vi.useRealTimers()
  })

  describe.each(['linux', 'win32'] as const)('on %s', (platform) => {
    it('keeps Orca Ctrl+L and Ctrl+N even with a composer focus report', () => {
      withPlatform(platform, () => {
        const window = openWindow()
        for (const focused of [false, true]) {
          window.setDroidComposerFocused(focused)
          expect(window.press(ctrlL)).toEqual({ consumed: true, sent: TOGGLE_RIGHT_SIDEBAR })
          expect(window.press(ctrlN)).toEqual({ consumed: true, sent: CREATE_WORKTREE })
          expect(window.press({ ...ctrlL, key: 'д' })).toEqual({
            consumed: true,
            sent: TOGGLE_RIGHT_SIDEBAR
          })
          expect(window.press({ ...ctrlN, key: 'т' })).toEqual({
            consumed: true,
            sent: CREATE_WORKTREE
          })
        }
      })
    })
  })

  describe('on darwin', () => {
    it('keeps Cmd+L and Cmd+N on Orca, focused or not', () => {
      withPlatform('darwin', () => {
        const window = openWindow()
        for (const focused of [false, true]) {
          window.setDroidComposerFocused(focused)
          expect(window.press(cmdL)).toEqual({ consumed: true, sent: TOGGLE_RIGHT_SIDEBAR })
          expect(window.press(cmdN)).toEqual({ consumed: true, sent: CREATE_WORKTREE })
          expect(window.press(ctrlL)).toEqual({ consumed: false, sent: [] })
          expect(window.press(ctrlN)).toEqual({ consumed: false, sent: [] })
        }
      })
    })

    it.each(CLEAR_EVENTS)('releases profile claims after %s', (_name, clear) => {
      withPlatform('darwin', () => {
        const window = openWindow(true)
        expect(window.press(ctrlL)).toEqual({ consumed: true, sent: TOGGLE_RIGHT_SIDEBAR })
        window.setDroidComposerFocused(true)
        expect(window.press(ctrlL).consumed).toBe(false)
        expect(window.press(ctrlN).consumed).toBe(false)
        expect(window.press({ key: 'b', code: 'KeyB', meta: true }).consumed).toBe(true)
        clear(window)
        expect(window.press(ctrlL)).toEqual({ consumed: true, sent: TOGGLE_RIGHT_SIDEBAR })
        expect(window.press(ctrlN)).toEqual({ consumed: true, sent: CREATE_WORKTREE })
      })
    })

    it('rejects guest and malformed focus reports without changing other focus flags', () => {
      withPlatform('darwin', () => {
        const window = openWindow(true)
        window.setMarkdownEditorFocused(true)
        window.setTerminalInputFocused(true)
        window.setDroidComposerFocused(true, { id: 'guest-webview' })
        expect(window.press(ctrlL).consumed).toBe(true)
        for (const payload of ['true', 1, {}, null, undefined]) {
          window.setDroidComposerFocused(true)
          window.setDroidComposerFocused(payload)
          expect(window.press(ctrlL).consumed).toBe(true)
        }
      })
    })
  })
})
