import type { ProviderTimelineEvent } from '../native-chat/agent-session-timeline/provider-timeline-event'
import { droidAutonomyLowerThanAsked, type DroidAutonomyLevel } from './droid-autonomy-level'

const LEVEL_NAMES: Record<DroidAutonomyLevel, string> = {
  off: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High'
}

/** The one chat row for a level Droid clamped below the one asked for; none when it ran as asked. */
export function droidAutonomyCapRow(
  asked: DroidAutonomyLevel,
  reported: DroidAutonomyLevel | undefined
): ProviderTimelineEvent[] {
  if (!reported || !droidAutonomyLowerThanAsked(reported, asked)) {
    return []
  }
  return [
    {
      type: 'item.update',
      // The same cap on a later start is the same fact, so it updates this row instead of adding one.
      item: `autonomy-capped:${asked}:${reported}`,
      body: {
        kind: 'status',
        tone: 'warning',
        text: `Droid is running at autonomy level ${LEVEL_NAMES[reported]}, below the ${LEVEL_NAMES[asked]} set in Agent Permissions. Your organization may limit it.`
      }
    }
  ]
}
