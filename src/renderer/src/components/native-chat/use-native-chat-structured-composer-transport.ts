import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { dispatchStructuredAgentSessionComposerCommand } from '../../../../shared/structured-agent-session-composer'
import { useStructuredAgentAcceptsImages } from '@/runtime/use-host-structured-agent'
import type {
  NativeChatOptionPickerRequest,
  NativeChatStructuredComposerTransport
} from './native-chat-composer-types'
import { answerDroidHostCommand } from './droid-help-keys'
import { useDroidSessionCommands } from './use-droid-session-commands'
import type { NativeChatStructuredViewProps } from './native-chat-view-types'
import type { useStructuredAgentSession } from './use-structured-agent-session'
import type { StructuredAgentSessionQueuedMessagesController } from './use-structured-agent-session-queued-messages'

/** What the composer of a structured chat sends, picks and runs through, from the chat's controller. */
export function useNativeChatStructuredComposerTransport(args: {
  props: Pick<NativeChatStructuredViewProps, 'agent' | 'sessionId' | 'target' | 'tabId'>
  controller: ReturnType<typeof useStructuredAgentSession>
  /** Sends now, restarts a failed start with the message, or refuses while the chat starts. */
  sendThroughLaunch: (
    text: string,
    withImages: boolean,
    send: () => boolean | 'queued'
  ) => boolean | 'queued'
  /** The chat is starting: it takes no send yet. */
  starting: boolean
  worktreeId: string | undefined
  optionPickerRequest: NativeChatOptionPickerRequest | null
  setOptionPickerRequest: Dispatch<SetStateAction<NativeChatOptionPickerRequest | null>>
  onError: NativeChatStructuredComposerTransport['onError']
  onSubmitted: () => void
  queuedMessages: Pick<StructuredAgentSessionQueuedMessagesController, 'queueHold' | 'queueResume'>
}): NativeChatStructuredComposerTransport {
  const { props, controller, sendThroughLaunch, starting, worktreeId, optionPickerRequest } = args
  const { setOptionPickerRequest, onError, onSubmitted, queuedMessages } = args
  const droidSessionCommands = useDroidSessionCommands({
    tabId: props.tabId,
    sessionId: props.sessionId,
    target: props.target,
    agent: props.agent,
    optionSnapshot: controller.optionSnapshot,
    optionSurface: controller.optionSurface
  })
  const acceptsImages = useStructuredAgentAcceptsImages(props.target, props.agent)
  return useMemo((): NativeChatStructuredComposerTransport => {
    const threadGoal = controller.threadGoal
    const setThreadGoalObjective = threadGoal
      ? (objective: string) => threadGoal.change({ kind: 'set', objective })
      : null
    return {
      send: (text, attachments, options) =>
        sendThroughLaunch(text, attachments.length > 0, () => {
          const images = attachments.map(({ path, connectionId }) => ({
            path,
            previewUri: path,
            ...(connectionId ? { connectionId } : {})
          }))
          return options ? controller.send(text, images, options) : controller.send(text, images)
        }),
      dispatchCommand: (text: string) => {
        droidSessionCommands?.noteSubmit(text)
        return dispatchStructuredAgentSessionComposerCommand(text, {
          agent: props.agent,
          snapshot: controller.optionSnapshot,
          invokeAction: async (id) => {
            setOptionPickerRequest((current) => ({ id, sequence: (current?.sequence ?? 0) + 1 }))
            return true
          },
          setOption: controller.setStructuredOption,
          conversationCommands: controller.conversationCommands,
          runConversationCommand: controller.runConversationCommand,
          ...(setThreadGoalObjective ? { setThreadGoalObjective } : {}),
          ...(props.agent === 'droid' ? { answerHostCommand: answerDroidHostCommand } : {}),
          ...(droidSessionCommands ? { runHostCommand: droidSessionCommands.runHostCommand } : {})
        })
      },
      ...(setThreadGoalObjective ? { threadGoal: { setObjective: setThreadGoalObjective } } : {}),
      sendOut: controller.sendOut || starting,
      optionsSurface: controller.optionSurface,
      conversationCommands: controller.conversationCommands,
      optionSnapshot: controller.optionSnapshot,
      optionPickerRequest,
      sessionCommands: controller.sessionCommands,
      acceptsImages,
      contextUsage: controller.contextUsage,
      worktreeId,
      onError,
      onSubmitted,
      runtime: props.target.kind === 'local' ? 'local' : 'remote',
      sessionId: props.sessionId,
      runtimeEnvironmentId:
        props.target.kind === 'local' ? null : (props.target.environmentId ?? null),
      queueHold: queuedMessages.queueHold,
      queueResume: queuedMessages.queueResume
    }
  }, [
    acceptsImages,
    controller,
    droidSessionCommands,
    worktreeId,
    onError,
    onSubmitted,
    optionPickerRequest,
    props.agent,
    props.sessionId,
    props.target,
    queuedMessages,
    sendThroughLaunch,
    setOptionPickerRequest,
    starting
  ])
}
