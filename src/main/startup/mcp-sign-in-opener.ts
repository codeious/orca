import { shell } from 'electron'
import { parseExternalHttpUrl } from '../ipc/external-http-url'
import { mainProcessState as state } from './main-process-state'

/** Opens an MCP sign-in link in this machine's browser; false when it cannot, with the failure's
 *  message dropped because it can repeat the link. A headless server (no window) opens nothing. */
export async function openMcpSignInOnThisMachine(rawUrl: string): Promise<boolean> {
  const parsed = parseExternalHttpUrl(rawUrl)
  if (!parsed || !state.mainWindow || state.mainWindow.isDestroyed()) {
    return false
  }
  try {
    await shell.openExternal(parsed.toString())
    return true
  } catch {
    return false
  }
}
