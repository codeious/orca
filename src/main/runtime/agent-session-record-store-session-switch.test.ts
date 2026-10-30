import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentSessionOwnerProbe } from '../../shared/agent-session-lease-adjudication'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import { DROID_ACCOUNT_HOME_VARIABLE } from '../droid/droid-agent-definition'
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

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-agent-session-switch-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function reserveDroid(sessionId: string, n: number): AgentSessionReserveRequest {
  return {
    sessionId,
    location: LOCATION,
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

async function openStore(): Promise<AgentSessionRecordStore> {
  return openTestAgentSessionRecordStore(directory)
}

describe('a Droid chat switched to another Droid session', () => {
  it('shows only the new session after a restart and keeps the old one for Session History', async () => {
    const store = await openStore()
    await store.reserveOwner(reserveDroid('droid-old', 1))
    await store.setSessionTabVisibility('droid-old', true)
    await store.reserveOwner(reserveDroid('droid-new', 2))

    // The switch publishes the new chat, then releases the old chat's tab.
    await store.setSessionTabVisibility('droid-new', true)
    await store.setSessionTabVisibility('droid-old', false)

    const restarted = await openStore()
    expect(restarted.getVisibleSessionTabIndex()).toEqual({
      present: true,
      sessionIds: ['droid-new']
    })
    expect(restarted.getSessionTabId('droid-new')).not.toBeNull()
    expect(restarted.getSessionTabId('droid-old')).toBeNull()
    expect(restarted.getRecord('droid-old')).toMatchObject({ sessionId: 'droid-old' })
    expect(restarted.getRecord('droid-new')).toMatchObject({ sessionId: 'droid-new' })
  })
})
