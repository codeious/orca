import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { switchDroidChatSession } from '@/lib/droid-chat-session-switch'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import type { AgentJournalSpecHandoff } from '../../../../shared/agent-session-journal-spec-handoff'

function droidSpecHandoffsIn(items: readonly AgentJournalRenderItem[]): AgentJournalSpecHandoff[] {
  const handoffs: AgentJournalSpecHandoff[] = []
  for (const { body } of items) {
    if (body.kind === 'status' && body.specHandoff) {
      handoffs.push(body.specHandoff)
    }
  }
  return handoffs
}

function openDroidSpecHandoff(fromTabId: string, handoff: AgentJournalSpecHandoff): void {
  const failed = (): void => {
    toast.error(
      translate(
        'components.native-chat.specHandoff.failed',
        'Could not open the new Droid session. The planning session is still open.'
      )
    )
  }
  try {
    const { settlement } = switchDroidChatSession({
      fromTabId,
      placement: 'replace',
      // Auto, whatever the saved default: the plan is approved, and Spec would only ask again.
      target: {
        kind: 'existing',
        droidSessionId: handoff.newSessionId,
        settings: {
          spec: false,
          ...(handoff.autonomyLevel ? { autonomyLevel: handoff.autonomyLevel } : {})
        }
      },
      firstMessage: handoff.initialPrompt
    })
    void settlement.then((settled) => {
      if (settled.kind === 'failed' && !settled.notified) {
        failed()
      }
    }, failed)
  } catch {
    failed()
  }
}

/**
 * Moves a Droid chat to the session its Spec plan was handed to. Only a handoff that arrives after
 * the chat first loaded counts: one already in the history belongs to a past answer, so opening a
 * chat or restarting never starts a second session.
 */
export function useDroidSpecHandoff(args: {
  tabId: string
  agent: AgentType
  status: 'idle' | 'loading' | 'ready' | 'error'
  journalItems: readonly AgentJournalRenderItem[]
}): void {
  const { tabId, agent, status, journalItems } = args
  const handled = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (agent !== 'droid' || status !== 'ready') {
      return
    }
    const handoffs = droidSpecHandoffsIn(journalItems)
    if (handled.current === null) {
      handled.current = new Set(handoffs.map((handoff) => handoff.specHandoffId))
      return
    }
    for (const handoff of handoffs) {
      if (!handled.current.has(handoff.specHandoffId)) {
        handled.current.add(handoff.specHandoffId)
        openDroidSpecHandoff(tabId, handoff)
      }
    }
  }, [agent, journalItems, status, tabId])
}
