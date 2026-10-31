import { normalizeAgentSessionConversationName } from '../../shared/agent-session-conversation-name'
import type { StructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger'

export type DroidTitleUpdate = { sessionId: string; title: string }

/** `manual_rename` is a person's title and holds the name against every later automatic one; a title with no
 *  `updateType` is not a rename, so it never takes that hold, but a held name still refuses it. */
export class DroidChatTitle {
  private renamedByHand = false

  accept(report: { title?: string | undefined; updateType?: string | undefined }): string | null {
    const name = normalizeAgentSessionConversationName(report.title)
    if (name === null) {
      return null
    }
    if (report.updateType === 'manual_rename') {
      this.renamedByHand = true
      return name
    }
    return this.renamedByHand ? null : name
  }
}

export function recordDroidTitle(deps: {
  store: { setConversationName: (sessionId: string, name: string) => Promise<unknown> }
  publish: (sessionId: string) => void
  logger: StructuredAgentSessionLogger
}): (update: DroidTitleUpdate) => void {
  const { store, publish, logger } = deps
  return ({ sessionId, title }) => {
    void store.setConversationName(sessionId, title).then(
      () => {
        try {
          publish(sessionId)
        } catch (error) {
          logger.warn('Droid chat title was not published', {
            scope: 'droid-title',
            sessionId,
            error
          })
        }
      },
      (error: unknown) =>
        logger.warn('Droid chat title was not saved', { scope: 'droid-title', sessionId, error })
    )
  }
}
