import { randomUUID } from 'node:crypto'
import { isDroidAutonomyLevel, type DroidAutonomyLevel } from '../../shared/droid-autonomy-options'
import type { ProviderTimelineEvent } from '../native-chat/agent-session-timeline/provider-timeline-event'
import { droidHostText } from './droid-host-text'
import type { DroidNotification } from './droid-session-notifications'

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

/** The handoffs this session asked for. Droid echoes the id it was given, so only its echo of one
 *  of these opens a session: nothing else that names a session can move the chat. */
export class DroidSpecHandoffs {
  private readonly asked = new Map<string, DroidAutonomyLevel | undefined>()

  constructor(private readonly newId: () => string = randomUUID) {}

  begin(option: string): string {
    const id = this.newId()
    const level = droidPlanOptionLevel(option)
    this.asked.set(id, level !== null && isDroidAutonomyLevel(level) ? level : undefined)
    return id
  }

  /** The one row that tells the chat which session to open, and with what. */
  created(
    notification: Extract<DroidNotification, { type: 'spec_handoff_session_created' }>
  ): ProviderTimelineEvent[] {
    const { specHandoffId, newSessionId, initialPrompt } = notification
    if (!this.asked.has(specHandoffId)) {
      return []
    }
    const autonomyLevel = this.asked.get(specHandoffId)
    this.asked.delete(specHandoffId)
    return [
      {
        type: 'item.close',
        item: `spec-handoff:${specHandoffId}`,
        body: {
          kind: 'status',
          ...droidHostText('specHandoff'),
          specHandoff: {
            newSessionId,
            initialPrompt,
            specHandoffId,
            ...(autonomyLevel ? { autonomyLevel } : {})
          }
        }
      }
    ]
  }
}
