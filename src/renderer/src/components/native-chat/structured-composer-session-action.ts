import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { normalizeAgentSessionConversationName } from '../../../../shared/agent-session/agent-session-conversation-name'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { openStructuredChatFork } from '@/lib/open-structured-chat-fork'
import type { useStructuredAgentSession } from './use-structured-agent-session'

export async function runStructuredComposerSessionAction(
  input: {
    target: RuntimeClientTarget
    tabId: string
    sessionId: string
    controller: ReturnType<typeof useStructuredAgentSession>
  },
  name: 'rename' | 'fork',
  argument: string
): Promise<{ accepted: boolean; error: string | null }> {
  try {
    if (name === 'rename') {
      const title = normalizeAgentSessionConversationName(argument)
      if (!title) {
        return { accepted: false, error: 'Use /rename followed by a chat name.' }
      }
      await callRuntimeRpc(input.target, 'agentSession.rename', {
        sessionId: input.sessionId,
        name: title
      })
      return { accepted: true, error: null }
    }
    if (argument) {
      return { accepted: false, error: '/fork does not take arguments.' }
    }
    const outcome = await input.controller.copyConversation()
    if (outcome.kind !== 'done') {
      return { accepted: false, error: outcome.kind === 'not-done' ? outcome.notice : null }
    }
    const opened = await openStructuredChatFork(input.tabId, outcome.value.providerSessionId)
    return { accepted: opened, error: opened ? null : 'The fork could not be opened.' }
  } catch {
    return { accepted: false, error: 'The chat action could not be completed.' }
  }
}
