import type {
  AiVaultPrepareChatTerminalHandoffArgs,
  AiVaultSessionResumePreparation
} from '../../../shared/ai-vault/resume/ai-vault-resume-preparation'
import { agentSessionLeasePossiblyWriting } from '../../../shared/agent-session/lifecycle/leases/agent-session-lease-adjudication'
import { agentSessionProviderHandleChainHead } from '../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle'
import { getNativeChatAgentProfile } from '../../../shared/native-chat/native-chat-agent-profiles'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { prepareStructuredChatCliFork } from './structured-chat-cli-fork'

const CHAT_BUSY = 'Wait for this chat to finish before continuing in a terminal.'

export async function prepareStructuredChatTerminalHandoff(
  args: AiVaultPrepareChatTerminalHandoffArgs,
  prepare: AiVaultSessionResumePreparation
) {
  const host = getStructuredAgentSessionHost()
  const record = host?.deps.store.getRecord(args.sourceChat.sessionId)
  if (!host || !record || !getNativeChatAgentProfile(record.provider)?.terminalHandoff) {
    throw new Error('This chat cannot continue in the same terminal conversation.')
  }
  const linkId = agentSessionProviderHandleChainHead(record.providerHandleChain)?.linkId
  const requireSameChat = () => {
    const current = host.deps.store.requireWritableRecord(record.sessionId)
    if (
      current.provider !== record.provider ||
      current.location.workspaceId !== args.sourceChat.workspaceId ||
      current.location.executionHostId !== 'local' ||
      current.location.wslDistro !== null ||
      agentSessionProviderHandleChainHead(current.providerHandleChain)?.linkId !== linkId ||
      host.deps.adapter.holdsDispatch?.(record.sessionId)
    ) {
      throw new Error(CHAT_BUSY)
    }
    return current
  }
  const work = await host.currentWork(record.sessionId)
  const current = requireSameChat()
  if (
    (!work && agentSessionLeasePossiblyWriting(current.lease)) ||
    work?.working() ||
    work?.hasActionablePrompt()
  ) {
    throw new Error(CHAT_BUSY)
  }
  // Reuse transcript/account validation; handoff agents fork at CLI launch, never during preparation.
  return prepareStructuredChatCliFork(
    { sourceChat: args.sourceChat, fork: true },
    async (resume) => {
      await host.close(record.sessionId, 'user-close', ({ sessionId, state }) => {
        requireSameChat()
        if (sessionId !== record.sessionId || state !== 'idle') {
          throw new Error(CHAT_BUSY)
        }
        return true
      })
      const requireExited = () => {
        if (agentSessionLeasePossiblyWriting(requireSameChat().lease)) {
          throw new Error("Could not prove the chat's agent exited. Keep this chat open and retry.")
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
