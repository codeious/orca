import type {
  AiVaultPrepareChatTerminalHandoffArgs,
  AiVaultSessionResumePreparation
} from '../../shared/ai-vault-resume-preparation'
import { agentSessionLeasePossiblyWriting } from '../../shared/agent-session/lifecycle/agent-session-lease-adjudication'
import { agentSessionProviderHandleChainHead } from '../../shared/agent-session/lifecycle/agent-session-provider-handle'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { prepareStructuredChatCliFork } from './structured-chat-cli-fork'

export async function prepareStructuredChatTerminalHandoff(
  args: AiVaultPrepareChatTerminalHandoffArgs,
  prepare: AiVaultSessionResumePreparation
) {
  const host = getStructuredAgentSessionHost()
  const record = host?.deps.store.getRecord(args.sourceChat.sessionId)
  if (!host || record?.provider !== 'droid') {
    throw new Error('Only Droid chats can continue in the same terminal conversation.')
  }
  const linkId = agentSessionProviderHandleChainHead(record.providerHandleChain)?.linkId
  const requireIdle = () => {
    const current = host.deps.store.requireWritableRecord(record.sessionId)
    const work = host.currentWork(record.sessionId)
    if (
      current.provider !== 'droid' ||
      current.location.workspaceId !== args.sourceChat.workspaceId ||
      current.location.executionHostId !== 'local' ||
      current.location.wslDistro !== null ||
      agentSessionProviderHandleChainHead(current.providerHandleChain)?.linkId !== linkId ||
      (!work && agentSessionLeasePossiblyWriting(current.lease)) ||
      work?.working() ||
      work?.hasActionablePrompt() ||
      host.deps.adapter.holdsDispatch?.(record.sessionId)
    ) {
      throw new Error('Wait for this chat to finish before continuing in a terminal.')
    }
    return true
  }
  requireIdle()
  // Reuse transcript/account validation; Droid forks at CLI launch, never during preparation.
  return prepareStructuredChatCliFork(
    { sourceChat: args.sourceChat, fork: true },
    async (resume) => {
      await host.close(record.sessionId, 'user-close', requireIdle)
      const requireExited = () => {
        requireIdle()
        const current = host.deps.store.requireWritableRecord(record.sessionId)
        if (agentSessionLeasePossiblyWriting(current.lease)) {
          throw new Error(
            'Could not prove the Droid process exited. Keep this chat open and retry.'
          )
        }
      }
      requireExited()
      const { fork: _fork, ...sameSession } = resume
      const result = await prepare(sameSession)
      requireExited()
      return result
    }
  )
}
