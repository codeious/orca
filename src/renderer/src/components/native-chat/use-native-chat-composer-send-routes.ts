import { useNativeChatPtyComposerSend } from './use-native-chat-pty-composer-send'
import { useNativeChatStructuredComposerSend } from './use-native-chat-structured-composer-send'
import { useNativeChatComposerSubmit } from './use-native-chat-composer-submit'

type ComposerSendRoutesArgs = Parameters<typeof useNativeChatPtyComposerSend>[0] &
  Parameters<typeof useNativeChatStructuredComposerSend>[0] &
  Omit<Parameters<typeof useNativeChatComposerSubmit>[0], 'sendPty' | 'sendStructured'>

/** Both transport routes share the draft, attachments and submit gate. */
export function useNativeChatComposerSendRoutes(args: ComposerSendRoutesArgs) {
  const sendStructured = useNativeChatStructuredComposerSend(args)
  const sendPty = useNativeChatPtyComposerSend(args)
  const submission = useNativeChatComposerSubmit({ ...args, sendPty, sendStructured })
  return { sendStructured, submission }
}
