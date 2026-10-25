// Droid's list names no model a new chat runs, so the composer stays empty until a no-pick session
// reports the model and effort it resolved. A workspace `.factory` that sets one hides that default.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { AgentSessionModelCatalogResult } from '../../shared/agent-session-wire'
import { structuredAgentSessionSeedCatalog } from '../../shared/structured-agent-session-seed-catalog'
import {
  applyStructuredAgentSessionModelCatalog,
  applyStructuredAgentSessionOptions,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionSnapshot,
  type StructuredAgentSessionOptionState
} from '../../shared/structured-agent-session-options'
import { createAgentModelCatalogService } from '../native-chat/agent-model-catalog/agent-model-catalog-service'
import { AgentModelCatalogStore } from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import {
  agentReadsProjectModelConfig,
  workspaceMayOverrideDefaultModel
} from '../native-chat/agent-model-catalog/agent-project-model-override'
import {
  closeProviderTimelineRigs,
  openProviderTimelineRig
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { DROID_HANDLE_TRANSPORT } from './droid-agent-definition'
import { createDroidModelCatalogProbe } from './droid-model-catalog-probe'
import type { DroidConnection } from './droid-session'
import { DroidSessionAdapter } from './droid-session-adapter'

const DROID_HOME = { variable: 'ORCA_DROID_ACCOUNT_HOME', path: '/homes/droid/.factory' }
const MODELS = [
  {
    id: 'gpt-6-sol',
    displayName: 'GPT-6 Sol',
    supportedReasoningEfforts: ['low', 'high'],
    defaultReasoningEffort: 'medium',
    isCustom: false
  },
  {
    id: 'custom:Fake-Local-0',
    displayName: 'Fake Local',
    supportedReasoningEfforts: ['none'],
    defaultReasoningEffort: 'none',
    isCustom: true
  }
]

let root: string
const adapters: DroidSessionAdapter[] = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-droid-default-'))
})

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.closeAll()))
  await closeProviderTimelineRigs()
  rmSync(root, { recursive: true, force: true })
})

function workspace(name: string, files: Record<string, string> = {}): string {
  const dir = join(root, name)
  mkdirSync(join(dir, '.git'), { recursive: true })
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}

function started(modelId: string, effort: string, models: readonly object[] = MODELS) {
  return {
    sessionId: 'droid-session-1',
    settings: { modelId, reasoningEffort: effort },
    availableModels: models
  }
}

class ListingConnection {
  pid = 4123
  closed = false
  rootVerdict: DroidConnection['rootVerdict'] = 'live'
  processless = false
  protocolVersion: string | undefined = '1.275.0'
  lastCloseResult: DroidConnection['lastCloseResult'] = null
  readonly requests: { method: string; params: unknown }[] = []
  constructor(
    private readonly reply: {
      sessionId?: string
      settings: { modelId: string; reasoningEffort: string }
      availableModels: readonly object[]
    },
    private readonly folder: string
  ) {}
  async request(method: string, params: unknown = {}): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === 'droid.initialize_session') {
      return this.reply
    }
    // A load names no id of its own. Echoing a different one would be a different session.
    // It does report the folder the session was recorded in.
    if (method === 'droid.load_session') {
      return {
        settings: this.reply.settings,
        availableModels: this.reply.availableModels,
        cwd: this.folder
      }
    }
    return {}
  }
  async close(): ReturnType<DroidConnection['close']> {
    this.closed = true
    this.rootVerdict = 'exited'
    return { root: 'exited', tree: 'exited' }
  }
  pauseReading(): void {}
  resumeReading(): void {}
  onExit(): void {}
}

type ChatOptions = {
  modelId?: string
  effort?: string
  models?: readonly object[]
  saved?: Readonly<Record<string, string>>
  resumeId?: string
}

async function droidHost() {
  const records = new Map<string, AgentSessionRecord>()
  const store = new AgentModelCatalogStore({ now: () => 1_000 })
  const catalog = createAgentModelCatalogService({
    store,
    getRecord: (sessionId) => records.get(sessionId),
    drivesRecord: () => true,
    resolveAccountHome: async () => DROID_HOME,
    recordWorkspacePath: async (row) => row.launchDirectory ?? null,
    agentReadsProjectModelConfig,
    workspaceMayOverrideDefaultModel,
    probes: {
      droid: createDroidModelCatalogProbe({
        resolveEnvironment: async () => ({ PATH: '/usr/bin' }),
        resolveCommand: () => '/opt/droid/bin/droid',
        probeVersion: async () => true,
        homePath: '/home/user',
        openConnection: () => ({
          request: async (method, params) => {
            if (method !== 'droid.list_models' || JSON.stringify(params) !== '{}') {
              throw new Error(`probe sent ${method} ${JSON.stringify(params)}`)
            }
            return { models: MODELS }
          },
          close: async () => {}
        })
      })
    }
  })

  let chats = 0
  async function chat(workspacePath: string, opts: ChatOptions = {}) {
    const sessionId = `droid-${++chats}`
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the catalog service reads only these fields.
    records.set(sessionId, {
      sessionId,
      provider: 'droid',
      accountHome: DROID_HOME,
      launchDirectory: workspacePath,
      location: {
        executionHostId: 'local',
        wslDistro: null,
        workspaceId: 'ws-1',
        workspaceKind: 'git-worktree'
      }
    } as AgentSessionRecord)
    const rig = await openProviderTimelineRig({ agent: 'droid', sessionId })
    const connection = new ListingConnection(
      started(opts.modelId ?? 'gpt-6-sol', opts.effort ?? 'high', opts.models ?? MODELS),
      workspacePath
    )
    const adapter = new DroidSessionAdapter({
      resolveLaunch: async () => ({
        command: '/opt/droid/bin/droid',
        cwd: workspacePath,
        env: { PATH: '/usr/bin' },
        autonomyLevel: 'off',
        previous: opts.resumeId
          ? {
              linkId: 'link-1',
              handle: {
                transport: DROID_HANDLE_TRANSPORT,
                agent: 'droid',
                nativeId: opts.resumeId
              },
              origin: 'created',
              mintedAtFence: 1,
              observedAt: 1
            }
          : null
      }),
      readProcessStartTime: async () => 1,
      openConnection: () => connection,
      onLifecycle: () => {},
      onSettled: () => {},
      onIdle: () => {},
      logger: { warn: () => {}, error: () => {} }
    })
    adapters.push(adapter)
    const acquired = await adapter.acquire({
      identity: {
        sessionId,
        workspaceId: 'ws-1',
        hostId: 'local',
        agent: 'droid',
        providerHandle: null
      },
      fence: 1,
      spawnToken: 'spawn-token',
      options: opts.saved ?? {},
      events: rig.eventSink
    })
    if (!acquired.catalogListing) {
      throw new Error('a Droid start hands the host its listing')
    }
    catalog.recordLiveListing(sessionId, acquired.catalogListing)
    return {
      listing: acquired.catalogListing,
      connection,
      readOptions: () => {
        if (!adapter.readOptions) {
          throw new Error('Droid options are not readable')
        }
        return adapter.readOptions({ sessionId, fence: 1 })
      }
    }
  }
  return { catalog, chat }
}

function frame(state: StructuredAgentSessionOptionState) {
  const snapshot = structuredAgentSessionOptionSnapshot(state)
  const select = (id: string) => {
    const entry = snapshot.find((descriptor) => descriptor.id === id)
    return entry?.kind.type === 'select' ? (entry.kind.currentValue ?? null) : null
  }
  return { model: select('model'), effort: select('effort') }
}

function firstFrame(answer: AgentSessionModelCatalogResult) {
  const seed = structuredAgentSessionSeedCatalog('droid')
  return frame(
    applyStructuredAgentSessionModelCatalog(
      createStructuredAgentSessionOptionState('droid', seed),
      seed,
      answer,
      { newLaunch: true }
    )
  )
}

const NOTHING = { model: null, effort: null }

describe('Droid model and effort in the composer', () => {
  it('shows a quiet Model pill before the host answers', () => {
    const seed = structuredAgentSessionSeedCatalog('droid')
    const snapshot = structuredAgentSessionOptionSnapshot(
      createStructuredAgentSessionOptionState('droid', seed)
    )
    expect(snapshot).toEqual([
      expect.objectContaining({
        id: 'model',
        valueSource: 'unknown',
        settable: false,
        kind: { type: 'select', choices: [] }
      })
    ])
  })

  it('lists models with no value, then the model and effort a no-pick chat ran', async () => {
    const { catalog, chat } = await droidHost()
    const clean = workspace('clean')
    const listed = await catalog.read({
      agent: 'droid',
      workspacePath: clean,
      waitForListing: true
    })
    expect(listed).toMatchObject({ origin: 'probe', listingNamesConfiguredModel: false })
    if (listed.origin === 'unknown') {
      throw new Error('the probe did not answer')
    }
    expect(listed.models.find((model) => model.id === 'custom:Fake-Local-0')).toMatchObject({
      isCustom: true
    })
    expect(listed.models.every((model) => model.defaultEffort === undefined)).toBe(true)
    expect(firstFrame(listed)).toEqual(NOTHING)
    const model = structuredAgentSessionOptionSnapshot(
      applyStructuredAgentSessionModelCatalog(
        createStructuredAgentSessionOptionState(
          'droid',
          structuredAgentSessionSeedCatalog('droid')
        ),
        structuredAgentSessionSeedCatalog('droid'),
        listed,
        { newLaunch: true }
      )
    ).find((descriptor) => descriptor.id === 'model')
    expect(model?.settable).toBe(true)
    expect(
      model?.kind.type === 'select' ? model.kind.choices.map((choice) => choice.value) : []
    ).toEqual(['gpt-6-sol', 'custom:Fake-Local-0'])

    await chat(clean)
    for (const path of [clean, workspace('other')]) {
      const answer = await catalog.read({ agent: 'droid', workspacePath: path })
      expect(answer).toMatchObject({ listingNamesConfiguredModel: true })
      expect(firstFrame(answer)).toEqual({ model: 'gpt-6-sol', effort: 'high' })
    }
  })

  it('keeps the running chat’s model when a later host answer names another', async () => {
    const { catalog, chat } = await droidHost()
    const clean = workspace('clean')
    await catalog.read({ agent: 'droid', workspacePath: clean, waitForListing: true })
    const startedChat = await chat(clean)
    const seed = structuredAgentSessionSeedCatalog('droid')
    const live = applyStructuredAgentSessionOptions(
      createStructuredAgentSessionOptionState('droid', seed),
      seed,
      await startedChat.readOptions()
    )
    expect(frame(live)).toEqual({ model: 'gpt-6-sol', effort: 'high' })
    const later = await catalog.read({ agent: 'droid', workspacePath: clean })
    expect(applyStructuredAgentSessionModelCatalog(live, seed, later, { newLaunch: true })).toBe(
      live
    )
  })

  it('hides the learned default in a workspace whose .factory settings pick a model', async () => {
    const { catalog, chat } = await droidHost()
    await chat(workspace('clean'))
    const configured = workspace('configured', {
      '.factory/settings.json': '{"model":"custom:Fake-Local-0"}'
    })
    expect(firstFrame(await catalog.read({ agent: 'droid', workspacePath: configured }))).toEqual(
      NOTHING
    )
  })

  it('learns nothing from a chat whose workspace .factory picks the model', async () => {
    const { catalog, chat } = await droidHost()
    await catalog.read({ agent: 'droid', waitForListing: true })
    await chat(
      workspace('configured', {
        '.factory/settings.local.json': '{"sessionDefaultSettings":{"reasoningEffort":"low"}}'
      })
    )
    expect(
      firstFrame(await catalog.read({ agent: 'droid', workspacePath: workspace('clean') }))
    ).toEqual(NOTHING)
  })

  it('learns nothing from a restored pick or a resumed session', async () => {
    const { catalog, chat } = await droidHost()
    await catalog.read({ agent: 'droid', waitForListing: true })
    const clean = workspace('clean')
    const picked = await chat(clean, { saved: { model: 'gpt-6-sol', effort: 'low' } })
    expect(picked.listing).not.toHaveProperty('configuredDefault')
    expect(picked.connection.requests[0]).toMatchObject({
      method: 'droid.initialize_session',
      params: { modelId: 'gpt-6-sol', reasoningEffort: 'low' }
    })
    const resumed = await chat(clean, { resumeId: 'old-session', saved: { model: 'gpt-6-sol' } })
    expect(resumed.listing).not.toHaveProperty('configuredDefault')
    expect(resumed.connection.requests.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: 'droid.load_session', params: { sessionId: 'old-session' } },
      {
        method: 'droid.update_session_settings',
        params: { autonomyLevel: 'off', interactionMode: 'auto' }
      },
      { method: 'droid.update_session_settings', params: { modelId: 'gpt-6-sol' } }
    ])
    expect(firstFrame(await catalog.read({ agent: 'droid', workspacePath: clean }))).toEqual(
      NOTHING
    )
  })

  it('retires a learned default when a no-pick session resolves a model outside the list', async () => {
    const { catalog, chat } = await droidHost()
    const clean = workspace('clean')
    await chat(clean)
    expect(firstFrame(await catalog.read({ agent: 'droid', workspacePath: clean }))).toEqual({
      model: 'gpt-6-sol',
      effort: 'high'
    })
    const retired = await chat(clean, { modelId: 'gone' })
    expect(retired.listing.configuredDefault).toBeNull()
    expect(firstFrame(await catalog.read({ agent: 'droid', workspacePath: clean }))).toEqual(
      NOTHING
    )
  })
})
