import type { PreloadApi } from '../../../../preload/api-types'

export const webWindowFocusApi: Pick<
  PreloadApi['ui'],
  | 'setMarkdownEditorFocused'
  | 'setDroidComposerFocused'
  | 'setRichMarkdownContextMenuTarget'
  | 'markPlainTextContextMenuTarget'
  | 'setTerminalInputFocused'
  | 'setFloatingFocus'
  | 'setShortcutRecorderFocused'
> = {
  setMarkdownEditorFocused: () => {},
  setDroidComposerFocused: () => {},
  setRichMarkdownContextMenuTarget: () => {},
  markPlainTextContextMenuTarget: () => {},
  setTerminalInputFocused: () => {},
  setFloatingFocus: () => {},
  setShortcutRecorderFocused: () => {}
}
