import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionJournalIdentity } from '../../shared/agent-session-journal-types'
import type { AgentSessionProviderHandleLink } from '../../shared/agent-session-provider-handle'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { DROID_ACCOUNT_HOME_VARIABLE, DROID_HANDLE_TRANSPORT } from './droid-agent-definition'
import { createDroidLaunchResolver, droidProviderLink } from './droid-structured-launch-resolution'

const identity: AgentSessionJournalIdentity = {
  sessionId: 'session-droid-resolve',
  workspaceId: 'folder-1',
  hostId: 'local',
  agent: 'droid',
  providerHandle: null
}
const readVersion = vi.fn(async (..._input: unknown[]): Promise<string | null> => '0.249.0')

let root: string
beforeEach(async () => {
  readVersion.mockReset().mockResolvedValue('0.249.0')
  root = await mkdtemp(join(tmpdir(), 'orca-droid-resolver-'))
})
afterEach(async () => {
  closeTestJournalHostDatabase(root)
  await rm(root, { recursive: true, force: true })
})

async function setup() {
  const store = await openTestAgentSessionRecordStore(root)
  const { record } = await store.reserveOwner({
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
  const launchArgs = { current: [] as string[] }
  const resolver = createDroidLaunchResolver({
    store,
    resolveWorkspacePath: async () => workspace,
    resolveEnvironment: async () => ({ PATH: '/host/bin', HOME: '/host/home' }),
    resolveLaunchArgs: () => launchArgs.current,
    resolveCommand,
    readVersion,
    orcaEnv: {}
  })
  const prior = (nativeId: string): AgentSessionProviderHandleLink => ({
    linkId: 'prior-link',
    handle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId },
    origin: 'created',
    mintedAtFence: 1,
    observedAt: 100
  })
  const withRecord = (patch: object) =>
    vi.spyOn(store, 'getRecord').mockReturnValue({ ...record, ...patch })
  return { store, record, workspace, resolver, resolveCommand, launchArgs, prior, withRecord }
}

describe('Droid host launch resolution', () => {
  it('resolves the runtime binary and folder with the host environment unchanged', async () => {
    const h = await setup()
    const launch = await h.resolver(identity)
    expect(launch).toEqual({
      command: '/host/bin/droid',
      cwd: h.workspace,
      env: { PATH: '/host/bin', HOME: '/host/home' },
      previous: null,
      autonomyLevel: 'off'
    })
    expect(h.resolveCommand).toHaveBeenCalledWith('droid', {
      pathEnv: '/host/bin',
      homePath: '/host/home'
    })
  })

  it.each([
    [[], 'off'],
    [['--auto', 'low'], 'low'],
    [['--auto=medium'], 'medium'],
    [['--auto', 'high'], 'high'],
    [['--skip-permissions-unsafe'], 'high']
  ] as const)(
    'reads the autonomy level from the Agent Permissions arguments %j',
    async (args, level) => {
      const h = await setup()
      h.launchArgs.current = [...args]
      await expect(h.resolver(identity)).resolves.toMatchObject({ autonomyLevel: level })
    }
  )

  it('re-reads the Agent Permissions arguments at every launch', async () => {
    const h = await setup()
    h.launchArgs.current = ['--auto', 'high']
    await expect(h.resolver(identity)).resolves.toMatchObject({ autonomyLevel: 'high' })
    h.launchArgs.current = []
    await expect(h.resolver(identity)).resolves.toMatchObject({ autonomyLevel: 'off' })
  })

  it('never hands the account label, or a home override, to the child', async () => {
    const h = await setup()
    const { env } = await h.resolver(identity)
    expect(env).not.toHaveProperty(DROID_ACCOUNT_HOME_VARIABLE)
    expect(env).not.toHaveProperty('FACTORY_HOME_OVERRIDE')
  })

  it('reads the installed release with the launch binary, folder and environment', async () => {
    const h = await setup()
    await h.resolver(identity)
    expect(readVersion).toHaveBeenCalledWith({
      program: '/host/bin/droid',
      cwd: h.workspace,
      env: { PATH: '/host/bin', HOME: '/host/home' }
    })
  })

  it('refuses a stable release below the floor before anything spawns, naming it', async () => {
    const h = await setup()
    readVersion.mockResolvedValue('0.230.0')
    await expect(h.resolver(identity)).rejects.toMatchObject({
      name: 'AgentSessionPreSpawnError',
      releaseFacts: { version: '0.230.0', floor: '0.238.0', updateCommand: 'droid update' }
    })
  })

  it('refuses a prerelease without calling it older', async () => {
    const h = await setup()
    readVersion.mockResolvedValue('0.250.0-beta.1')
    await expect(h.resolver(identity)).rejects.toMatchObject({
      name: 'AgentSessionPreSpawnError',
      releaseFacts: {}
    })
  })

  it('leaves an unreadable release to the spawn, which states a missing binary itself', async () => {
    const h = await setup()
    readVersion.mockResolvedValue(null)
    await expect(h.resolver(identity)).resolves.toMatchObject({ command: '/host/bin/droid' })
  })

  it('carries the previous Droid session so the start loads it', async () => {
    const h = await setup()
    const link = h.prior('droid-session-1')
    h.withRecord({ providerHandleChain: [link] })
    await expect(h.resolver(identity)).resolves.toMatchObject({ previous: link })
  })

  it('refuses a resume handle that is not a Droid session', async () => {
    const h = await setup()
    const link = h.prior('droid-session-1')
    h.withRecord({
      providerHandleChain: [{ ...link, handle: { ...link.handle, transport: 'jsonl-rpc' } }]
    })
    await expect(h.resolver(identity)).rejects.toThrow('not a Droid session')
    expect(readVersion).not.toHaveBeenCalled()
  })

  it('refuses a different execution host and a foreign account home before resolving the binary', async () => {
    const h = await setup()
    h.withRecord({ location: { ...h.record.location, executionHostId: 'ssh:remote' } })
    await expect(h.resolver(identity)).rejects.toThrow('another execution host')
    h.withRecord({ accountHome: { variable: 'CODEX_HOME', path: '/wrong' } })
    await expect(h.resolver(identity)).rejects.toThrow('account home')
    expect(h.resolveCommand).not.toHaveBeenCalled()
  })

  it('refuses a record of another agent', async () => {
    const h = await setup()
    h.withRecord({ provider: 'pi' })
    await expect(h.resolver(identity)).rejects.toThrow('Droid session record unavailable')
  })
})

describe('Droid provider handle link', () => {
  const launch = { command: 'droid', cwd: '/work', env: {} }

  it('mints a created link for a new session', () => {
    expect(
      droidProviderLink({ ...launch, previous: null }, 'droid-session-9', 3, 'link-1', 500)
    ).toEqual({
      linkId: 'link-1',
      handle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: 'droid-session-9' },
      origin: 'created',
      mintedAtFence: 3,
      observedAt: 500
    })
  })

  it('mints a resumed link for the session it loaded, and refuses any other id', async () => {
    const h = await setup()
    const previous = h.prior('droid-session-1')
    expect(
      droidProviderLink({ ...launch, previous }, 'droid-session-1', 4, 'link-2', 600)
    ).toMatchObject({ origin: 'resumed', handle: previous.handle })
    expect(() =>
      droidProviderLink({ ...launch, previous }, 'droid-session-2', 4, 'link-3', 600)
    ).toThrow('different session')
  })
})
