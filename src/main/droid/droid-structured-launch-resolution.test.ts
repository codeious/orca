import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentSessionJournalIdentity } from '../../shared/agent-session/journal/agent-session-journal-identity'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/store-lifecycle/journal-host-database-test-support'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session/records/agent-session-record-store-test-harness'
import { DROID_ACCOUNT_HOME_VARIABLE } from './droid-agent-definition'
import { createDroidLaunchResolver } from './droid-structured-launch-resolution'
import type { StructuredAgentCommandSettings } from '../native-chat/structured-agent-command-resolution'

const identity: AgentSessionJournalIdentity = {
  sessionId: 'session-droid-resolve',
  workspaceId: 'folder-1',
  hostId: 'local',
  agent: 'droid',
  providerHandle: null
}
const readVersion = vi.fn(async (..._input: unknown[]): Promise<{ version: string | null }> => ({
  version: '0.249.0'
}))

let root: string
beforeEach(async () => {
  readVersion.mockReset().mockResolvedValue({ version: '0.249.0' })
  root = await mkdtemp(join(tmpdir(), 'orca-droid-resolver-'))
})
afterEach(async () => {
  closeTestJournalHostDatabase(root)
  await rm(root, { recursive: true, force: true })
})

async function setup() {
  const store = await openTestAgentSessionRecordStore(root)
  await store.reserveOwner({
    sessionId: identity.sessionId,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'folder-1',
      workspaceKind: 'folder'
    },
    provider: 'droid',
    accountHome: { variable: DROID_ACCOUNT_HOME_VARIABLE, path: '/host/home/.factory' },
    expectedFence: null,
    spawnToken: 'spawn-droid',
    claimKeyId: 'key-1',
    handoffOperationId: null,
    probe: { outcome: 'reservation-unused' },
    operation: {
      callerKey: 'client-1',
      operationId: '1800000000000-00000000000000000000000000000001',
      fingerprint: 'droid-create'
    },
    now: 1_800_000_000_000
  })
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const resolveCommand = vi.fn((..._input: unknown[]) => '/host/bin/droid')
  const launchArgs: { current: string[] } = { current: [] }
  const commandSettings: { current: StructuredAgentCommandSettings } = { current: {} }
  const resolver = createDroidLaunchResolver({
    store,
    resolveWorkspacePath: async () => workspace,
    resolveEnvironment: async () => ({ PATH: '/host/bin', HOME: '/host/home' }),
    resolveLaunchArgs: () => launchArgs.current,
    resolveCommand,
    resolveCommandSettings: () => commandSettings.current,
    readVersion,
    orcaEnv: {}
  })
  return { resolver, commandSettings }
}

it('refuses a stable release below the floor before anything spawns, naming it', async () => {
  const h = await setup()
  readVersion.mockResolvedValue({ version: '0.230.0' })
  await expect(h.resolver(identity)).rejects.toMatchObject({
    name: 'AgentSessionPreSpawnError',
    installation: { agent: 'droid', installedVersion: '0.230.0', minimumVersion: '0.238.0' }
  })
})

it.each(['0.250.0-beta.1', null])(
  'refuses an unsupported installed release %j',
  async (version) => {
    const h = await setup()
    readVersion.mockResolvedValue({ version })
    const error = await h.resolver(identity).then(
      () => null,
      (error: unknown) => error
    )
    expect(error).toMatchObject({ name: 'AgentSessionPreSpawnError' })
    expect(error).not.toHaveProperty('installation')
  }
)

it('re-reads the configured program and its prefix arguments on acquisition', async () => {
  const h = await setup()
  h.commandSettings.current = {
    agentCmdOverrides: { droid: `"${process.execPath}" --first` }
  }
  await expect(h.resolver(identity)).resolves.toMatchObject({
    command: process.execPath,
    prefixArgs: ['--first']
  })
  h.commandSettings.current = {
    agentCmdOverrides: { droid: `"${process.execPath}" --second` }
  }
  await expect(h.resolver(identity)).resolves.toMatchObject({
    command: process.execPath,
    prefixArgs: ['--second']
  })
})
