import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import { agentModelCatalogEntry } from '../native-chat/agent-model-catalog/agent-model-catalog-entry'
import { createAgentModelCatalogFilePersistence } from '../native-chat/agent-model-catalog/agent-model-catalog-persistence'
import type { StructuredAgentModelCatalogContext } from '../runtime/structured-agent-runtime-registrations'
import { DROID_AGENT } from './droid-agent-definition'
import { createDroidModelCatalogProbe } from './droid-model-catalog-probe'
import {
  droidModelOptionsFromListing,
  droidStartCatalogListing,
  droidReportedSessionOptions
} from './droid-model-options'
import { DROID_RUNTIME_REGISTRATION } from './droid-runtime-registration'

const HOME = { variable: 'ORCA_DROID_ACCOUNT_HOME', path: '/homes/droid/.factory' }

const LISTING = {
  models: [
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
    },
    { id: 'blocked', displayName: 'Blocked', disabled: true, supportedReasoningEfforts: ['low'] },
    { displayName: 'nameless' }
  ]
}

function context(): StructuredAgentModelCatalogContext {
  const unused = async (): Promise<never> => {
    throw new Error('building a probe resolves nothing')
  }
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: building the probe only captures resolvers; none of these deps is read until it runs.
    deps: { stateDirectory: '/state' } as StructuredAgentModelCatalogContext['deps'],
    environment: {
      resolveBaseEnvironment: unused,
      resolveCodexEnvironment: unused,
      resolveClaudeInheritedEnv: unused
    }
  }
}

describe('droid.list_models rows', () => {
  it('keeps the BYOK id, drops a blocked row, and names no default effort', () => {
    expect(droidModelOptionsFromListing(LISTING)).toEqual([
      {
        id: 'gpt-6-sol',
        label: 'GPT-6 Sol',
        isDefault: false,
        efforts: [
          { value: 'low', label: 'low' },
          { value: 'high', label: 'high' }
        ]
      },
      {
        id: 'custom:Fake-Local-0',
        label: 'Fake Local',
        isDefault: false,
        isCustom: true,
        efforts: [{ value: 'none', label: 'none' }]
      }
    ])
    expect(droidModelOptionsFromListing(LISTING)[0]).not.toHaveProperty('defaultEffort')
  })

  it('teaches nothing from a reply that lists no model, and retires a model the list does not have', () => {
    expect(droidReportedSessionOptions({ sessionId: 's' })).toBeNull()
    const reported = droidReportedSessionOptions({
      settings: { modelId: 'gone', reasoningEffort: 'high' },
      availableModels: LISTING.models
    })
    expect(reported).not.toBeNull()
    expect(
      droidStartCatalogListing(reported!, { resolvesConfig: true, picked: new Set() })
        .configuredDefault
    ).toBeNull()
  })
})

describe('the session-less Droid model probe', () => {
  it('is a probe that does not treat the list as the configured model', () => {
    expect(DROID_RUNTIME_REGISTRATION.modelCatalog(context())).toMatchObject({
      kind: 'probe',
      listingNamesConfiguredModel: false
    })
    expect(DROID_AGENT.restingOptions.fallbackModels()).toBeNull()
    expect(DROID_AGENT.restingOptions.effortDefaultsToModel).toBe(false)
    expect(DROID_AGENT.restingOptions.acceptsKey('model')).toBe(true)
    expect(DROID_AGENT.restingOptions.acceptsKey('effort')).toBe(true)
    expect(DROID_AGENT.restingOptions.acceptsKey('planMode')).toBe(true)
    expect(DROID_AGENT.restingOptions.acceptsKey('fastMode')).toBe(false)
  })

  it('calls droid.list_models with no session and no includeDisabled, under the account HOME', async () => {
    const requests: { method: string; params: unknown }[] = []
    let launch: ProviderProcessLaunch | undefined
    const probe = createDroidModelCatalogProbe({
      resolveEnvironment: async () => ({ PATH: '/usr/bin', HOME: '/wrong' }),
      resolveCommand: () => '/opt/droid/bin/droid',
      probeVersion: async () => true,
      homePath: '/home/user',
      openConnection: (spec) => {
        launch = spec
        return {
          request: async (method, params) => {
            requests.push({ method, params })
            return LISTING
          },
          close: async () => {}
        }
      }
    })

    const listed = await probe(HOME)

    expect(requests).toEqual([{ method: 'droid.list_models', params: {} }])
    expect(launch?.command).toBe('/opt/droid/bin/droid')
    expect(launch?.env?.HOME).toBe('/homes/droid')
    expect(launch?.env?.USERPROFILE).toBe('/homes/droid')
    expect(launch?.env?.ORCA_AGENT_SESSION_SPAWN_TOKEN).toBeUndefined()
    expect(listed.models.map((model) => model.id)).toEqual(['gpt-6-sol', 'custom:Fake-Local-0'])
    expect(listed.origin).toBe('probe')
  })

  it('does not open droid when the installed release cannot run a structured chat', async () => {
    const openConnection = vi.fn()
    const probe = createDroidModelCatalogProbe({
      resolveEnvironment: async () => ({ PATH: '/usr/bin' }),
      resolveCommand: () => '/opt/droid/bin/droid',
      probeVersion: async () => false,
      openConnection
    })
    await expect(probe(HOME)).rejects.toThrow(/does not run structured chats/)
    expect(openConnection).not.toHaveBeenCalled()
  })

  it('fails a listing that names no model, so an empty answer is not stored', async () => {
    const probe = createDroidModelCatalogProbe({
      resolveEnvironment: async () => ({ PATH: '/usr/bin' }),
      resolveCommand: () => '/opt/droid/bin/droid',
      probeVersion: async () => true,
      openConnection: () => ({
        request: async () => ({ models: [] }),
        close: async () => {}
      })
    })
    await expect(probe(HOME)).rejects.toThrow(/listed no models/)
  })

  it('closes the child when the listing is stopped', async () => {
    let closed = 0
    const probe = createDroidModelCatalogProbe({
      resolveEnvironment: async () => ({ PATH: '/usr/bin' }),
      resolveCommand: () => '/opt/droid/bin/droid',
      probeVersion: async () => true,
      openConnection: () => ({
        request: () => new Promise(() => {}),
        close: async () => {
          closed += 1
        }
      })
    })
    await expect(probe(HOME, { signal: AbortSignal.abort() })).rejects.toThrow(/stopped/)
    expect(closed).toBeGreaterThan(0)
  })
})

describe('a BYOK row survives the catalog file', () => {
  it('keeps isCustom on the model it writes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-droid-catalog-'))
    try {
      const models = droidModelOptionsFromListing(LISTING)
      const entry = agentModelCatalogEntry(
        'droid',
        'fp',
        { models, origin: 'probe', at: 1 },
        null,
        null
      )
      if (!entry) {
        throw new Error('entry')
      }
      const persistence = createAgentModelCatalogFilePersistence(directory)
      persistence.save([entry])
      await persistence.flush()
      const loaded = await persistence.load()
      expect(loaded[0]?.models.find((model) => model.id === 'custom:Fake-Local-0')).toMatchObject({
        isCustom: true
      })
      expect(loaded[0]?.models.find((model) => model.id === 'gpt-6-sol')).not.toHaveProperty(
        'isCustom'
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
