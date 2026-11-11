import type { AgentSessionHistoryPage } from '../../../../../shared/agent-session/agent-session-wire'
import type { AgentSessionJournal } from '../../../agent-session-journal/journal-store'
import type { Subscriber } from './agent-session-subscribe-input'
import type { StructuredAgentSessionCurrentWork } from '../../observations/structured-agent-session-current-work'
import { withPublishedWork } from '../../observations/agent-session-published-work'
import { readAgentSessionHydrationPage } from '../history/agent-session-history-page'
import { subscriberHistoryReader } from '../history/agent-session-bounded-frames'

export function subscriberSnapshotPages(
  journal: AgentSessionJournal,
  fence: number,
  view: ReturnType<AgentSessionJournal['publicRead']>,
  work: StructuredAgentSessionCurrentWork | undefined
): (subscriber: Subscriber) => AgentSessionHistoryPage {
  // Cache each stored/bounded form separately; each sizes its own page.
  let storedPage: AgentSessionHistoryPage | undefined
  let boundedPage: AgentSessionHistoryPage | undefined
  const read = (subscriber: Subscriber): AgentSessionHistoryPage =>
    withPublishedWork(
      readAgentSessionHydrationPage(
        journal,
        fence,
        subscriberHistoryReader(subscriber),
        view.currentSnapshot()
      ),
      work
    )
  const pageFor = (subscriber: Subscriber): AgentSessionHistoryPage =>
    subscriber.readHistorySnapshot
      ? read(subscriber)
      : subscriber.boundedFrames
        ? (boundedPage ??= read(subscriber))
        : (storedPage ??= read(subscriber))

  return pageFor
}
