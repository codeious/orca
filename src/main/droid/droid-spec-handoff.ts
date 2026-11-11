import { createHash } from 'node:crypto'
import { isDroidAutonomyLevel, type DroidAutonomyLevel } from '../../shared/droid-autonomy-options'
import type { ProviderTimelineEvent } from '../native-chat/agent-session-timeline/provider-timeline-event'
import type { DroidNotification } from './droid-session-notifications'
import type { DroidPromptEnvironment } from './droid-prompt-presentation'

const HANDOFF_OPTION = 'proceed_new_session'
const LEVEL_SUFFIX = /^proceed_(?:auto_run|new_session)_(.+)$/

/** The autonomy level an option's value names (`proceed_auto_run_low`); null for one that names none. */
export function droidPlanOptionLevel(value: string): string | null {
  return LEVEL_SUFFIX.exec(value)?.[1] ?? null
}

/** An ending that moves the plan to a new session, which the client starts. */
export function startsDroidSpecHandoff(value: string): boolean {
  return value.startsWith(HANDOFF_OPTION)
}

// Only a handoff the host requested can create a continuation.
export class DroidSpecHandoffs {
  private readonly asked = new Map<
    string,
    {
      operationId: string
      option: string
      autonomyLevel?: DroidAutonomyLevel
      flight?: Promise<ProviderTimelineEvent[]>
    }
  >()

  constructor(
    private readonly sessionId: string,
    private readonly open: (handoff: DroidSpecHandoff) => Promise<void>
  ) {}

  begin(option: string, operationId: string): string {
    const hex = createHash('sha256').update(`${this.sessionId}\0${operationId}`).digest('hex')
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
    const prior = this.asked.get(id)
    if (prior) {
      if (prior.option !== option) {
        throw new Error('The plan handoff operation was already used for another option')
      }
      return id
    }
    const level = droidPlanOptionLevel(option)
    this.asked.set(id, {
      operationId,
      option,
      ...(level !== null && isDroidAutonomyLevel(level) ? { autonomyLevel: level } : {})
    })
    return id
  }

  async created(
    notification: Extract<DroidNotification, { type: 'spec_handoff_session_created' }>
  ): Promise<ProviderTimelineEvent[]> {
    const { specHandoffId, newSessionId, initialPrompt } = notification
    const request = this.asked.get(specHandoffId)
    if (!request || request.flight) {
      return []
    }
    request.flight = this.open({
      operationId: request.operationId,
      newSessionId,
      initialPrompt,
      specHandoffId,
      ...(request.autonomyLevel ? { autonomyLevel: request.autonomyLevel } : {})
    }).then(() => [
      {
        type: 'item.close',
        item: `spec-handoff:${specHandoffId}`,
        body: {
          kind: 'status',
          text: 'Plan continued in a new chat.'
        }
      }
    ])
    return request.flight
  }
}

export type DroidSpecHandoff = {
  operationId: string
  specHandoffId: string
  newSessionId: string
  initialPrompt: string
  autonomyLevel?: DroidAutonomyLevel
}

export function droidSpecHandoffHandlers(
  sessionId: string,
  open: ((sourceSessionId: string, handoff: DroidSpecHandoff) => Promise<void>) | undefined,
  apply: (events: ProviderTimelineEvent[]) => void
): {
  environment: Pick<DroidPromptEnvironment, 'beginSpecHandoff'>
  receive: (notification: Parameters<DroidSpecHandoffs['created']>[0]) => ProviderTimelineEvent[]
} {
  const handoffs = open
    ? new DroidSpecHandoffs(sessionId, (handoff) => open(sessionId, handoff))
    : null
  return {
    environment: handoffs
      ? {
          beginSpecHandoff: (option, operationId) => handoffs.begin(option, operationId)
        }
      : {},
    receive: (notification) => {
      if (handoffs) {
        void handoffs.created(notification).then(apply, () =>
          apply([
            {
              type: 'item.close',
              item: `spec-handoff:${notification.specHandoffId}`,
              body: {
                kind: 'status',
                text: 'The host could not confirm the new plan chat. Check Session History before retrying.'
              }
            }
          ])
        )
      }
      return []
    }
  }
}
