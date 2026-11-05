import { createReadStream } from 'node:fs'
import {
  agentJournalSubmissionKey,
  parseAgentJournalItemKey
} from '../../shared/agent-session/journal/agent-session-journal-item-key'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../shared/agent-session/journal/agent-session-journal-types'
import { isRootAgentJournalItem } from '../../shared/agent-session/journal/agent-session-journal-producer'
import { spelledProviderTimelineItemKey } from '../../shared/provider-timeline-item-key'
import { journalLifecycleItemMutation } from '../native-chat/agent-session-journal/journal-lifecycle-mutation'
import {
  legacyItemBody,
  LEGACY_IMPORT_BLOCK_LIMITS
} from '../native-chat/agent-session-journal/journal-legacy-import'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import type { StructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger'
import {
  continuedOutsideNotice,
  continuedOutsideRecordId,
  createHistoryCatchUpBatch,
  runHistoryCatchUp
} from '../native-chat/agent-session-wire/structured-agent-session-history-catch-up'
import { decodeDroidTranscriptLine } from '../native-chat/transcript-line-decoders-droid'
import { splitTranscriptStreamLines } from '../native-chat/transcript-stream-lines'
import { findDroidSessionFile } from './droid-session-file'
import { resolveDroidAccountHome } from './droid-account-home'
import {
  resolveProviderChildEnv,
  type ProviderProcessLaunch
} from '../provider-process/provider-process-launch'
import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/structured-agent-session-adapter'

export async function catchUpLoadedDroidSession(
  acquire: StructuredAgentSessionAcquireInput,
  launch: ProviderProcessLaunch,
  providerSessionId: string,
  isIdle: () => boolean,
  logger: StructuredAgentSessionLogger
): Promise<void> {
  if (!acquire.events) {
    return
  }
  await catchUpDroidTranscript({
    sessionId: acquire.identity.sessionId,
    providerSessionId,
    accountHomePath: resolveDroidAccountHome({
      launchEnv: resolveProviderChildEnv(launch, process.env)
    }).path,
    sink: acquire.events,
    logger,
    assertCurrent: () => {
      if (!isIdle()) {
        throw new Error('Droid made live progress before history catch-up')
      }
    }
  })
}

/** Optional display history only: never settles a send or refuses opening the chat. */
export async function catchUpDroidTranscript(input: {
  sessionId: string
  providerSessionId: string
  accountHomePath: string
  sink: StructuredAgentSessionEventSink
  signal?: AbortSignal
  assertCurrent?: () => void
  logger?: StructuredAgentSessionLogger
}): Promise<void> {
  await runHistoryCatchUp({
    agentName: 'Droid',
    scope: 'droid-history-catch-up',
    sessionId: input.sessionId,
    sink: input.sink,
    signal: input.signal,
    assertCurrent: input.assertCurrent,
    logger: input.logger,
    timeoutMs: 30_000,
    readView: (history) => {
      const held = new Set<string>()
      const echoes = new Map(
        history
          .submissions()
          .flatMap((submission) =>
            submission.providerItemId
              ? [
                  [
                    agentJournalSubmissionKey(submission.clientMessageId),
                    submission.providerItemId
                  ] as const
                ]
              : []
          )
      )
      const state: { newest: { id: string; sequence: number; index: number } | null } = {
        newest: null
      }
      history.visitItemsWithLinkage((key, sequence, body, linkage) => {
        if (body.kind !== 'message' || !isRootAgentJournalItem(linkage)) {
          return
        }
        const identity = parseAgentJournalItemKey(echoes.get(key) ?? key)
        if (
          identity?.provider !== 'legacy' ||
          identity.agent !== 'droid' ||
          (identity.sessionId !== input.sessionId && identity.sessionId !== input.providerSessionId)
        ) {
          return
        }
        const encoded = spelledProviderTimelineItemKey(identity.recordId)
        let recordId = identity.recordId
        if (encoded !== null) {
          try {
            recordId = decodeURIComponent(encoded)
          } catch {
            return
          }
        }
        const id = encoded === null ? recordId : /^message:[^:]+:([^:]+):/.exec(recordId)?.[1]
        if (!id || id.startsWith('continued-outside:')) {
          return
        }
        held.add(id)
        const index = history.item(key)?.sequenceIndex ?? 0
        const newest = state.newest
        if (
          !newest ||
          sequence > newest.sequence ||
          (sequence === newest.sequence && index > newest.index)
        ) {
          state.newest = { id, sequence, index }
        }
      })
      return { held, anchor: state.newest?.id ?? null, sequence: history.cursor().sequence }
    },
    sameView: (planned, current) => planned.sequence === current.sequence,
    prepare: async ({ view, check, signal, yieldTurn, warn }) => {
      const { held, anchor } = view()
      if (!anchor) {
        return null
      }
      const file = await findDroidSessionFile(input.accountHomePath, input.providerSessionId)
      check()
      if (!file) {
        return null
      }
      const batch = createHistoryCatchUpBatch()
      let found = false
      const imported = new Set<string>()
      const stream = createReadStream(file, { signal })
      try {
        for await (const { line, terminated } of splitTranscriptStreamLines(
          stream,
          16 * 1024 * 1024
        )) {
          check()
          if (!terminated) {
            continue
          }
          const message = decodeDroidTranscriptLine(line, '')
          if (!message?.id) {
            continue
          }
          if (!found) {
            found = message.id === anchor
            continue
          }
          if (held.has(message.id) || imported.has(message.id)) {
            continue
          }
          if (batch.size === 0) {
            batch.push(
              journalLifecycleItemMutation(
                { turnScope: AGENT_JOURNAL_THREAD_SCOPE },
                {
                  provider: 'legacy',
                  agent: 'droid',
                  sessionId: input.sessionId,
                  recordId: continuedOutsideRecordId(anchor)
                },
                continuedOutsideNotice(false)
              )
            )
          }
          imported.add(message.id)
          batch.push(
            journalLifecycleItemMutation(
              { turnScope: AGENT_JOURNAL_THREAD_SCOPE, observedAt: message.timestamp ?? undefined },
              {
                provider: 'legacy',
                agent: 'droid',
                sessionId: input.providerSessionId,
                recordId: message.id
              },
              legacyItemBody(message, LEGACY_IMPORT_BLOCK_LIMITS)
            )
          )
          await yieldTurn()
        }
      } finally {
        stream.destroy()
      }
      if (!found) {
        warn('anchor-not-in-transcript')
        return null
      }
      return batch.finish('droid-history-import', [input.providerSessionId, anchor, [...imported]])
    }
  })
}
