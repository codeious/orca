import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { agentSessionConversationView } from '../../shared/agent-session/lifecycle/agent-session-conversation-view'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session/records/agent-session-record-store-test-harness'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/store-lifecycle/journal-host-database-test-support'
import { StructuredAgentRegistry } from '../native-chat/agent-session-wire/providers/structured-agent-registry'
import { readStructuredAgentSessionOptionsAtRest } from '../native-chat/agent-session-wire/options/structured-agent-session-resting-options'
import { DROID_AGENT } from './droid-agent-definition'
import { DroidSessionAdapter } from './droid-session-adapter'
import { createAgentModelCatalogService } from '../native-chat/agent-model-catalog/agent-model-catalog-service'
import { AgentModelCatalogStore } from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import {
  agentReadsProjectModelConfig,
  workspaceMayOverrideDefaultModel
} from '../native-chat/agent-model-catalog/agent-project-model-override'
import { DROID_RUNTIME_METADATA } from './droid-runtime-metadata'
import { createStructuredAgentSessionLogger } from '../native-chat/agent-session-wire/host/structured-agent-session-logger'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup()
  }
})

async function catalog() {
  const root = await mkdtemp(join(tmpdir(), 'orca-droid-catalog-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const accountHome = { variable: 'ORCA_DROID_ACCOUNT_HOME', path: join(root, '.factory') }
  await mkdir(accountHome.path)
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const program = join(root, 'droid.cjs')
  await writeFile(
    program,
    `
if (process.env.HOME !== process.env.DROID_TEST_HOME) process.exit(9)
if (process.argv.includes('--version')) {
  console.log('1.5.0')
} else {
  require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
    const request = JSON.parse(line)
    if (request.method !== 'droid.list_models' ||
        Object.keys(request.params).length !== 0 ||
        process.env.ORCA_AGENT_SESSION_SPAWN_TOKEN) process.exit(12)
    console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { models: [
      { id: 'normal-model', displayName: 'Normal', supportedReasoningEfforts: ['low', 'high'] },
      { id: 'custom:local', displayName: 'Local', isCustom: true, supportedReasoningEfforts: ['none'] },
      { id: 'blocked', disabled: true }
    ] } }))
  })
}
`
  )
  const env = { HOME: root, USERPROFILE: root, DROID_TEST_HOME: root }
  const discovery = DROID_RUNTIME_METADATA.modelCatalog({
    deps: {
      stateDirectory: root,
      resolveWorkspacePath: async () => root,
      resolveLaunchArgs: () => [],
      resolveClaudeAuthPolicy: () => {
        throw new Error('Unused Claude policy')
      },
      resolveAgentCommandSettings: () => ({
        agentCmdOverrides: { droid: `"${process.execPath}" "${program}"` }
      })
    },
    environment: {
      resolveBaseEnvironment: async () => env,
      resolveAgentEnvironment: async () => env,
      refreshAfterMissingProgram: async () => {},
      bindCatalogSources: () => () => {}
    }
  })
  const records = await openTestAgentSessionRecordStore(root)
  cleanups.push(async () => {
    closeTestJournalHostDatabase(root)
  })
  const reserved = await records.reserveOwner({
    sessionId: 'droid-interrupted',
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'folder',
      workspaceKind: 'folder'
    },
    provider: 'droid',
    accountHome,
    launchDirectory: workspace,
    options: { model: 'normal-model', planMode: 'true' },
    expectedFence: null,
    spawnToken: 'fixture-spawn',
    claimKeyId: 'fixture-key',
    handoffOperationId: null,
    probe: { outcome: 'reservation-unused' },
    operation: {
      callerKey: 'fixture',
      operationId: '1800000000000-00000000000000000000000000000001',
      fingerprint: 'create-fixture'
    },
    now: 1_800_000_000_000
  })
  const record = await records.evictProvenDeadOwner({
    sessionId: 'droid-interrupted',
    expectedFence: reserved.record.lease.runtimeFence,
    probe: { outcome: 'reservation-unused' },
    now: 1_800_000_000_001
  })
  const store = new AgentModelCatalogStore()
  const service = createAgentModelCatalogService({
    store,
    getRecord: (id) => records.getRecord(id) ?? undefined,
    getConversation: (id) => {
      const row = records.getRecord(id)
      return row ? agentSessionConversationView(row) : undefined
    },
    drivesRecord: () => true,
    resolveAccountHome: async () => accountHome,
    recordWorkspacePath: async () => workspace,
    agentReadsProjectModelConfig,
    workspaceMayOverrideDefaultModel,
    probes: discovery.kind === 'probe' ? { droid: discovery.probe } : {}
  })
  cleanups.push(async () => {
    await service.stop()
  })
  return { root, workspace, service, store, record, records, accountHome }
}

it('discovers alternatives for an interrupted chat without starting a new provider session', async () => {
  const h = await catalog()
  expect(
    await h.service.read({
      agent: 'droid',
      sessionId: h.record.sessionId,
      workspacePath: h.workspace,
      waitForListing: true
    })
  ).toMatchObject({
    origin: 'probe',
    models: [{ id: 'normal-model' }, { id: 'custom:local', isCustom: true }]
  })
})

it('shows configured Normal and Spec defaults only while the folder cannot replace them', async () => {
  const h = await catalog()
  await writeFile(
    join(h.accountHome.path, 'settings.json'),
    JSON.stringify({
      sessionDefaultSettings: {
        model: 'normal-model',
        reasoningEffort: 'high',
        specModeModel: 'custom:local',
        specModeReasoningEffort: 'none'
      }
    })
  )
  expect(
    await h.service.read({
      agent: 'droid',
      sessionId: h.record.sessionId,
      workspacePath: h.workspace,
      waitForListing: true
    })
  ).toMatchObject({
    origin: 'probe',
    listingNamesConfiguredModel: true,
    configuredSpec: { model: 'custom:local', effort: 'none' },
    models: [
      { id: 'normal-model', isDefault: true, defaultEffort: 'high' },
      { id: 'custom:local', isDefault: false }
    ]
  })
  const resting = await readStructuredAgentSessionOptionsAtRest(
    {
      store: h.records,
      agents: new StructuredAgentRegistry([
        {
          definition: DROID_AGENT,
          adapter: new DroidSessionAdapter({
            resolveLaunch: async () => {
              throw new Error('Resting reads must not start a chat')
            },
            onLifecycle: () => {},
            onSettled: () => {},
            onIdle: () => {},
            logger: createStructuredAgentSessionLogger()
          })
        }
      ]),
      modelCatalog: h.service
    },
    h.record.sessionId,
    { readsWithoutModel: true },
    {}
  )
  expect(resting.current).toMatchObject({
    planMode: true,
    model: 'custom:local',
    effort: 'none',
    defaulted: ['model', 'effort']
  })
  await mkdir(join(h.workspace, '.factory'))
  await writeFile(
    join(h.workspace, '.factory', 'settings.local.json'),
    '{"sessionDefaultSettings":{"specModeModel":"project-model"}}'
  )
  h.service.retireContext()
  const overridden = await h.service.read({
    agent: 'droid',
    sessionId: h.record.sessionId,
    workspacePath: h.workspace,
    waitForListing: true
  })
  expect(overridden).toMatchObject({
    origin: 'probe',
    listingNamesConfiguredModel: false,
    models: [
      { id: 'normal-model', isDefault: false },
      { id: 'custom:local', isDefault: false }
    ]
  })
  expect(overridden).not.toHaveProperty('configuredSpec')
})
