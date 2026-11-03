import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter
} from '../../droid/droid-adapter-rig.test-support'
import { DROID_AGENT, DROID_ACCOUNT_HOME_VARIABLE } from '../../droid/droid-agent-definition'
import { foundAgentSessionRecord } from '../../runtime/agent-session/records/agent-session-record-founding'
import { seedTestAgentSessionRecordStore } from '../../runtime/agent-session/records/agent-session-record-store-test-harness'
import { StructuredAgentRegistry } from './structured-agent-registry'
import { recordStructuredAgentSessionOptionIntent } from './structured-agent-session-option-intent'
import { createRestTestRig } from './structured-agent-session-rest-test-rig'

afterEach(runDroidRigCleanups)

describe('Droid permission intent at rest', () => {
  it('refuses an unknown level without changing or publishing the saved options', async () => {
    const droid = await setupDroidAdapter()
    const agents = new StructuredAgentRegistry([
      { definition: DROID_AGENT, adapter: droid.adapter }
    ])
    const rig = await createRestTestRig({ agents })
    try {
      const record = foundAgentSessionRecord(
        {
          sessionId: DROID_RIG_SESSION,
          provider: 'droid',
          accountHome: { variable: DROID_ACCOUNT_HOME_VARIABLE, path: '/home/user' },
          location: {
            workspaceId: 'folder-1',
            workspaceKind: 'folder',
            executionHostId: 'local',
            wslDistro: null
          },
          options: { autonomyLevel: 'low', model: 'main' }
        },
        { claimKeyId: 'key-1', now: 1 }
      )
      await seedTestAgentSessionRecordStore(rig.root, { records: [record] })
      await rig.restart()
      const before = rig.store.getRecord(DROID_RIG_SESSION)
      const publish = vi.fn()
      const picked = await recordStructuredAgentSessionOptionIntent(
        { store: rig.store, agents },
        {
          sessionId: DROID_RIG_SESSION,
          fence: record.lease.runtimeFence,
          publish,
          now: () => 2
        },
        { key: 'autonomyLevel', value: 'mission' }
      )
      expect(picked).toMatchObject({
        ok: false,
        refusal: {
          code: 'agent_session_operation_invalid',
          details: { reason: 'optionRejected' }
        }
      })
      expect(publish).not.toHaveBeenCalled()
      expect(droid.openConnection).not.toHaveBeenCalled()
      await rig.restart()
      expect(rig.store.getRecord(DROID_RIG_SESSION)).toEqual(before)
    } finally {
      await rig.dispose()
    }
  })

  it('saves a pick without starting Droid and uses it on the next launch', async () => {
    const droid = await setupDroidAdapter({ autonomyLevel: 'high' })
    const agents = new StructuredAgentRegistry([
      { definition: DROID_AGENT, adapter: droid.adapter }
    ])
    const rig = await createRestTestRig({ agents })
    try {
      const record = foundAgentSessionRecord(
        {
          sessionId: DROID_RIG_SESSION,
          provider: 'droid',
          accountHome: { variable: DROID_ACCOUNT_HOME_VARIABLE, path: '/home/user' },
          location: {
            workspaceId: 'folder-1',
            workspaceKind: 'folder',
            executionHostId: 'local',
            wslDistro: null
          }
        },
        { claimKeyId: 'key-1', now: 1 }
      )
      await seedTestAgentSessionRecordStore(rig.root, { records: [record] })
      await rig.restart()
      const publish = vi.fn()
      const picked = await recordStructuredAgentSessionOptionIntent(
        { store: rig.store, agents },
        {
          sessionId: DROID_RIG_SESSION,
          fence: record.lease.runtimeFence,
          publish,
          now: () => 2
        },
        { key: 'autonomyLevel', value: 'low' }
      )
      expect(picked).toMatchObject({
        ok: true,
        value: { key: 'autonomyLevel', value: 'low', options: { autonomyLevel: 'low' } }
      })
      expect(publish).toHaveBeenCalledOnce()
      expect(droid.openConnection).not.toHaveBeenCalled()
      await rig.restart()
      const saved = rig.store.getRecord(DROID_RIG_SESSION)?.options
      expect(saved).toEqual({ autonomyLevel: 'low' })
      const { connection } = await droid.start(saved)
      expect(
        connection.requests.find((request) => request.method === 'droid.initialize_session')?.params
      ).toMatchObject({ autonomyLevel: 'low' })
    } finally {
      await rig.dispose()
    }
  })
})
