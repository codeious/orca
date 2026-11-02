import { ipcMain, type BrowserWindow } from 'electron'

export type DroidComposerFocusMirror = {
  dispose: () => void
  isFocused: () => boolean
  reset: () => void
}

const DROID_COMPOSER_FOCUS_CHANNEL = 'ui:setDroidComposerFocused'

/** Mirrors Droid composer focus so before-input-event leaves Droid's Ctrl+L and Ctrl+N to the
 *  composer. Separate from the markdown flag, which exempts only a bare Cmd/Ctrl+B. */
export function installDroidComposerFocusMirror(
  mainWindow: BrowserWindow
): DroidComposerFocusMirror {
  let focused = false
  const sender = mainWindow.webContents
  // Why: strict-bool + sender check so a guest/webview or malformed payload can't disable the shortcuts.
  const onFocused = (event: Electron.IpcMainEvent, value: unknown): void => {
    if (event.sender !== sender) {
      return
    }
    focused = value === true
  }
  ipcMain.on(DROID_COMPOSER_FOCUS_CHANNEL, onFocused)
  const reset = (): void => {
    focused = false
  }
  // Why: a window that loses OS focus must hand Ctrl+L and Ctrl+N back even if the composer never reports its blur.
  mainWindow.on('blur', reset)
  return {
    dispose: () => {
      reset()
      mainWindow.removeListener('blur', reset)
      ipcMain.removeListener(DROID_COMPOSER_FOCUS_CHANNEL, onFocused)
    },
    isFocused: () => focused,
    reset
  }
}
