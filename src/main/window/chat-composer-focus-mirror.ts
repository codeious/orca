import { ipcMain, type BrowserWindow } from 'electron'
import type { AgentType } from '../../shared/agent-status/contracts/agent-status-types'

export type ChatComposerFocusMirror = {
  dispose: () => void
  focusedAgent: () => AgentType | null
  reset: () => void
}

const CHAT_COMPOSER_FOCUS_CHANNEL = 'ui:setChatComposerFocused'

/** Mirrors which agent's chat composer holds focus, so before-input-event leaves that agent's claimed
 *  window chords to the composer. Separate from the markdown flag, which exempts only a bare Cmd/Ctrl+B. */
export function installChatComposerFocusMirror(mainWindow: BrowserWindow): ChatComposerFocusMirror {
  let focusedAgent: AgentType | null = null
  const sender = mainWindow.webContents
  // Why: sender check + string-only payload so a guest/webview or malformed report can't take Orca's shortcuts.
  const onFocused = (event: Electron.IpcMainEvent, agent: unknown): void => {
    if (event.sender !== sender) {
      return
    }
    focusedAgent = typeof agent === 'string' ? agent : null
  }
  ipcMain.on(CHAT_COMPOSER_FOCUS_CHANNEL, onFocused)
  const reset = (): void => {
    focusedAgent = null
  }
  // Why: a window that loses OS focus must hand the chords back even if the composer never reports its blur.
  mainWindow.on('blur', reset)
  return {
    dispose: () => {
      reset()
      mainWindow.removeListener('blur', reset)
      ipcMain.removeListener(CHAT_COMPOSER_FOCUS_CHANNEL, onFocused)
    },
    focusedAgent: () => focusedAgent,
    reset
  }
}
