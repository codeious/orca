import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import { DROID_ACCOUNT_HOME_VARIABLE } from '../../droid/droid-agent-definition'
import { closeTestJournalHostDatabases } from '../../native-chat/agent-session-journal/journal-host-database-test-support'
import { createStructuredAgentSessionLogger } from '../../native-chat/agent-session-wire/structured-agent-session-logger'
import { seedTestAgentSessionRecordStore } from './records/agent-session-record-store-test-harness'
import {
  ensureStructuredAgentSessionHost,
  stopStructuredAgentSessionRuntime
} from './structured-agent-session-runtime'

let directory: string | undefined

afterEach(async () => {
  await stopStructuredAgentSessionRuntime()
  await closeTestJournalHostDatabases()
  if (directory) {
    await rm(directory, { recursive: true, force: true })
    directory = undefined
  }
})

it.each(['local', 'runtime:remote'] as const)(
  '%s reports configured Droid permissions at rest before spawning a child',
  async (hostId) => {
    const root = await mkdtemp(join(tmpdir(), 'orca-droid-resting-options-'))
    directory = root
    const record = {
      ...agentSessionRecordFixture(
        agentSessionLeaseFixture({
          claimStatus: 'released',
          ownerProcess: null,
          provenHandleLinkId: null,
          reservedSpawnToken: null
        })
      ),
      location: {
        executionHostId: hostId,
        wslDistro: null,
        workspaceId: 'folder-1',
        workspaceKind: 'folder' as const
      },
      provider: 'droid',
      providerHandleChain: [],
      accountHome: { variable: DROID_ACCOUNT_HOME_VARIABLE, path: root }
    }
    await seedTestAgentSessionRecordStore(root, { records: [record] })
    const openDroidConnection = vi.fn(() => {
      throw new Error('An at-rest options read must not spawn Droid')
    })
    const host = await ensureStructuredAgentSessionHost({
      logger: createStructuredAgentSessionLogger(),
      stateDirectory: root,
      hostId,
      claimKeyId: 'key-1',
      resolveWorkspacePath: async () => root,
      resolveEnvironment: async () => ({}),
      resolveClaudeAuthPolicy: () => ({ account: 'managed' }),
      resolveLaunchArgs: async (provider) => (provider === 'droid' ? ['--auto', 'high'] : []),
      openDroidConnection
    })

    const options = await host.readOptions(record.sessionId)

    expect(options.sessionOptions?.find((row) => row.id === 'autonomyLevel')).toMatchObject({
      valueSource: 'default',
      kind: { type: 'select', currentValue: 'high' }
    })
    expect(openDroidConnection).not.toHaveBeenCalled()
  }
)
