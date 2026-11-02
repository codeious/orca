import { afterPendingTab } from '@/runtime/layout-owner-pending-tabs'
import { newAgentLaunchRequestId } from './agent-launch-request-id'
import { beginStructuredAgentLaunchSettlement } from './structured-agent-launch-settlement'
import { openStructuredAgentSessionProvisionalTab } from './agent-session/launch/structured-agent-session-launch-surface'
import { structuredAgentSessionOwnerForTab } from '@/runtime/structured-agent-session-owner'
import { useAppStore } from '@/store'
import { isTuiAgent } from '../../../shared/tui-agent-config'

/** Open the saved copy beside its source, carrying the workspace and execution host. */
export async function openStructuredChatFork(
  fromTabId: string,
  providerSessionId: string
): Promise<boolean> {
  const state = useAppStore.getState()
  const source = state.getTab(fromTabId)
  const agent = source?.agentSessionAgent
  if (source?.contentType !== 'agent-session' || !agent || !isTuiAgent(agent)) {
    throw new Error('The source chat is no longer open.')
  }
  const executionHostId = structuredAgentSessionOwnerForTab(state, source)
  const handle = beginStructuredAgentLaunchSettlement(
    source.worktreeId,
    agent,
    {
      requestId: newAgentLaunchRequestId(),
      ...(executionHostId ? { executionHostId } : {}),
      resumeFrom: { providerSessionId }
    },
    {}
  )
  try {
    const tab = openStructuredAgentSessionProvisionalTab({
      worktreeId: source.worktreeId,
      executionHostId: handle.executionHostId,
      sessionId: handle.sessionId,
      agent,
      activate: true,
      afterTabId: source.id
    })
    const drawn = new Promise<string | null>((resolve) => afterPendingTab(tab.id, resolve))
    const settled = await handle.settlement
    return settled.kind === 'structured' && (await drawn) !== null
  } catch (error) {
    handle.cancel()
    throw error
  }
}
