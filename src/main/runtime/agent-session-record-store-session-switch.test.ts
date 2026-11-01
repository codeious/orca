import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../shared/agent-session-journal-types'
import type { AgentSessionOwnerProbe } from '../../shared/agent-session-lease-adjudication'
import type { AgentSessionProviderHandleLink } from '../../shared/agent-session-provider-handle'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import {
  DROID_ACCOUNT_HOME_VARIABLE,
  DROID_HANDLE_TRANSPORT
} from '../droid/droid-agent-definition'
import { recordDroidTitle } from '../droid/droid-session-title'
import { createTrackedJournalOpener } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import type { AgentSessionRecordStore } from './agent-session-record-store'
import { openTestAgentSessionRecordStore } from './agent-session-record-store-test-harness'
import type { AgentSessionReserveRequest } from './agent-session-reservation-admission'

const NOW = 1_800_000_000_000
const LOCATION: AgentSessionExecutionLocation = {
  executionHostId: 'local',
  wslDistro: null,
  workspaceId: 'workspace-1',
  workspaceKind: 'git-worktree'
}
const INDETERMINATE: AgentSessionOwnerProbe = { outcome: 'indeterminate', reason: 'no answer' }
const SWITCHES = [
  { name: 'handoff', adopted: true, replace: true },
  { name: 'rewind', adopted: true, replace: true },
  { name: 'clear', adopted: false, replace: true },
  { name: 'new', adopted: false, replace: true },
  { name: 'compress-new-id', adopted: true, replace: true },
  { name: 'open-fork', adopted: true, replace: false }
] as const
const VISIBLE = [
  'droid-handoff-new',
  'droid-rewind-new',
  'droid-clear-new',
  'droid-new-new',
  'droid-compress-new-id-new',
  'droid-open-fork-old',
  'droid-open-fork-new'
]
const journals = createTrackedJournalOpener()

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-agent-session-switch-'))
})

afterEach(async () => {
  await journals.closeAll()
  await rm(directory, { recursive: true, force: true })
})

function reserveDroid(
  sessionId: string,
  n: number,
  location: AgentSessionExecutionLocation
): AgentSessionReserveRequest {
  return {
    sessionId,
    location,
    provider: 'droid',
    accountHome: { variable: DROID_ACCOUNT_HOME_VARIABLE, path: '/home/dev/.factory' },
    expectedFence: null,
    spawnToken: `spawn-${n}`,
    claimKeyId: `key-${n}`,
    handoffOperationId: null,
    probe: INDETERMINATE,
    operation: {
      callerKey: 'client-1',
      operationId: `${NOW}-${String(n).padStart(32, '0')}`,
      fingerprint: `fp-${n}`
    },
    now: NOW
  }
}

function handleLink(
  sessionId: string,
  origin: 'created' | 'adopted' | 'resumed'
): AgentSessionProviderHandleLink {
  return {
    linkId: `${sessionId}-${origin}`,
    handle: {
      transport: DROID_HANDLE_TRANSPORT,
      agent: 'droid',
      nativeId: `provider-${sessionId}`
    },
    origin,
    mintedAtFence: 1,
    observedAt: NOW
  }
}

async function establishOwner(
  store: AgentSessionRecordStore,
  request: AgentSessionReserveRequest,
  adopted = false
): Promise<void> {
  await store.reserveOwner({
    ...request,
    ...(adopted ? { adoptedHandleLink: handleLink(request.sessionId, 'adopted') } : {})
  })
  await store.commitProcessIdentity({
    sessionId: request.sessionId,
    fence: 1,
    process: {
      hostId: request.location.executionHostId,
      pid: 4000 + Number(request.claimKeyId.slice('key-'.length)),
      processStartTimeMs: NOW,
      spawnToken: `spawn-${request.claimKeyId.slice('key-'.length)}`
    },
    now: NOW
  })
  await store.proveOwner({
    sessionId: request.sessionId,
    fence: 1,
    link: handleLink(request.sessionId, adopted ? 'resumed' : 'created'),
    now: NOW
  })
}

async function openJournal(store: AgentSessionRecordStore, sessionId: string) {
  const record = store.getRecord(sessionId)
  const head = record?.providerHandleChain.at(-1)
  if (!record || !head) {
    throw new Error(`Missing persisted identity for ${sessionId}`)
  }
  return journals.open({
    stateDirectory: directory,
    identity: {
      sessionId,
      agent: record.provider,
      workspaceId: record.location.workspaceId,
      hostId: record.location.executionHostId,
      providerHandle: head.handle
    }
  })
}

async function saveExchange(store: AgentSessionRecordStore, sessionId: string): Promise<void> {
  const journal = await openJournal(store, sessionId)
  for (const role of ['user', 'assistant'] as const) {
    await journal.appendItem(
      { provider: 'legacy', agent: 'droid', sessionId, recordId: role },
      { kind: 'message', role, blocks: [{ type: 'text', text: `${sessionId}: ${role}` }] },
      { fence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
    )
  }
}

// Command/renderer tests own choosing a target; these exercise the durable writes they publish.
describe.each([
  ['local worktree', LOCATION],
  ['runtime folder', { ...LOCATION, executionHostId: 'runtime:server-1', workspaceKind: 'folder' }]
] as const)('the switch population after restarting a %s host', (_name, location) => {
  it('restores each target, title and host, and reopens history without acquiring a writer or submitting a prompt', async () => {
    let store = await openTestAgentSessionRecordStore(directory, {
      hostId: location.executionHostId
    })
    const publishedTitle = vi.fn()
    const logger = { warn: vi.fn(), error: vi.fn() }
    const title = recordDroidTitle({ store, publish: publishedTitle, logger })
    const tabIds = new Map<string, string | null>()
    let operation = 0
    for (const transition of SWITCHES) {
      const source = `droid-${transition.name}-old`
      const target = `droid-${transition.name}-new`
      await establishOwner(store, reserveDroid(source, ++operation, location))
      await store.setConversationName(source, `Earlier ${transition.name}`)
      await saveExchange(store, source)
      await store.setSessionTabVisibility(source, true)
      tabIds.set(source, store.getSessionTabId(source))
      await establishOwner(store, reserveDroid(target, ++operation, location), transition.adopted)
      if (transition.adopted) {
        await saveExchange(store, target)
      }
      title({ sessionId: target, title: `Droid title: ${transition.name}` })
      await vi.waitFor(() => expect(publishedTitle).toHaveBeenLastCalledWith(target))
      await store.setSessionTabVisibility(target, true)
      tabIds.set(target, store.getSessionTabId(target))
      if (transition.replace) {
        await store.setSessionTabVisibility(source, false)
        await store.evictProvenDeadOwner({
          sessionId: source,
          expectedFence: 1,
          probe: { outcome: 'exit-observed' },
          now: NOW + 1
        })
      }
    }
    expect(logger.warn).not.toHaveBeenCalled()
    expect(store.getVisibleSessionTabIndex()).toEqual({ present: true, sessionIds: VISIBLE })

    // Close the SQLite connection, not just the in-memory record store.
    for (let restart = 0; restart < 2; restart++) {
      await journals.closeAll()
      store = await openTestAgentSessionRecordStore(directory, {
        hostId: location.executionHostId
      })
      expect(store.hostId).toBe(location.executionHostId)
      expect(store.listRecords()).toHaveLength(12)
      expect(store.listByScope(location)).toHaveLength(12)
      expect(store.listOperationRows()).toHaveLength(12)
      expect(store.getVisibleSessionTabIndex()).toEqual({ present: true, sessionIds: VISIBLE })

      for (const transition of SWITCHES) {
        const source = `droid-${transition.name}-old`
        const target = `droid-${transition.name}-new`
        const oldRecord = store.getRecord(source)
        const newRecord = store.getRecord(target)
        expect(newRecord).toMatchObject({
          provider: 'droid',
          location,
          accountHome: { variable: DROID_ACCOUNT_HOME_VARIABLE, path: '/home/dev/.factory' },
          conversationName: `Droid title: ${transition.name}`,
          lease: {
            runtimeFence: 1,
            claimStatus: 'live',
            unreconciled: true,
            ownerProcess: { hostId: location.executionHostId },
            provenHandleLinkId: `${target}-${transition.adopted ? 'adopted' : 'created'}`
          }
        })
        expect(newRecord?.providerHandleChain).toEqual([
          handleLink(target, transition.adopted ? 'adopted' : 'created')
        ])
        expect(store.getSessionTabId(target)).toBe(tabIds.get(target))
        expect(oldRecord).toMatchObject({
          location,
          conversationName: `Earlier ${transition.name}`,
          providerHandleChain: [handleLink(source, 'created')],
          lease: {
            runtimeFence: transition.replace ? 2 : 1,
            claimStatus: transition.replace ? 'released' : 'live',
            unreconciled: true
          }
        })
        expect(store.getSessionTabId(source)).toBe(transition.replace ? null : tabIds.get(source))

        // A history view must not mint a new owner, even when opened more than once.
        const oldLease = oldRecord?.lease
        for (let reopen = 0; reopen < 2; reopen++) {
          await store.setSessionTabVisibility(source, true, tabIds.get(source) ?? undefined)
          expect(store.getSessionTabId(source)).toBe(tabIds.get(source))
          const journal = await openJournal(store, source)
          expect(journal.snapshot().items.map(({ body }) => body)).toEqual([
            { kind: 'message', role: 'user', blocks: [{ type: 'text', text: `${source}: user` }] },
            {
              kind: 'message',
              role: 'assistant',
              blocks: [{ type: 'text', text: `${source}: assistant` }]
            }
          ])
          expect(journal.submissions()).toEqual([])
          expect(journal.activeTurnId()).toBeNull()
          expect(store.getRecord(source)?.lease).toEqual(oldLease)
          await journal.close()
          if (transition.replace) {
            await store.setSessionTabVisibility(source, false)
          }
        }
        const targetJournal = await openJournal(store, target)
        expect(targetJournal.snapshot().items.map(({ body }) => body)).toEqual(
          transition.adopted
            ? [
                {
                  kind: 'message',
                  role: 'user',
                  blocks: [{ type: 'text', text: `${target}: user` }]
                },
                {
                  kind: 'message',
                  role: 'assistant',
                  blocks: [{ type: 'text', text: `${target}: assistant` }]
                }
              ]
            : []
        )
        expect(targetJournal.submissions()).toEqual([])
        await targetJournal.close()
        expect(store.getRecord(target)?.lease).toEqual(newRecord?.lease)
        await expect(
          store.renewLease({
            sessionId: target,
            fence: 1,
            childProbe: { outcome: 'identity-matched', matchedOn: ['spawn-token'] },
            now: NOW + 10
          })
        ).rejects.toThrow('execution_owner_reconciling')
      }
      expect(store.listOperationRows()).toHaveLength(12)
      expect(store.getVisibleSessionTabIndex()).toEqual({ present: true, sessionIds: VISIBLE })
    }
  })
})
