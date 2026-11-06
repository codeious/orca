import { expect, it, vi } from 'vitest'
import { agentSessionConversationView } from '../../shared/agent-session/lifecycle/agent-session-conversation-view'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import { createAgentModelCatalogService } from '../native-chat/agent-model-catalog/agent-model-catalog-service'
import { AgentModelCatalogStore } from '../native-chat/agent-model-catalog/agent-model-catalog-store'
import { DROID_HANDLE_TRANSPORT } from './droid-agent-definition'
import { createDroidModelCatalogProbe } from './droid-model-catalog-probe'

it('discovers alternatives for an interrupted Droid chat without starting another session', async () => {
  const accountHome = { variable: 'ORCA_DROID_ACCOUNT_HOME', path: '/fixtures/account/.factory' }
  const record = {
    ...agentSessionRecordFixture(
      agentSessionLeaseFixture({
        claimStatus: 'released',
        ownerProcess: null,
        deathEvidence: {
          kind: 'pid-absent',
          detail: 'interrupted owner exited',
          observedAt: 1_000,
          ownerFence: 7
        }
      })
    ),
    provider: 'droid',
    accountHome,
    launchDirectory: '/folder-workspace',
    options: { model: 'custom:saved', effort: 'high', planMode: 'false' },
    providerHandleChain: [
      {
        linkId: 'droid-link',
        origin: 'created' as const,
        mintedAtFence: 7,
        observedAt: 1_000,
        handle: {
          transport: DROID_HANDLE_TRANSPORT,
          agent: 'droid',
          nativeId: 'interrupted-droid-session'
        }
      }
    ]
  }
  const request = vi.fn(async (method: string) => {
    if (method !== 'droid.list_models') {
      throw new Error(`Model discovery must not send ${method}`)
    }
    return {
      models: [
        { id: 'custom:saved', displayName: 'Saved model', supportedReasoningEfforts: ['high'] },
        { id: 'custom:alternative', displayName: 'Alternative', supportedReasoningEfforts: ['low'] }
      ]
    }
  })
  const service = createAgentModelCatalogService({
    store: new AgentModelCatalogStore(),
    getRecord: (id) => (id === record.sessionId ? record : undefined),
    getConversation: (id) =>
      id === record.sessionId ? agentSessionConversationView(record) : undefined,
    drivesRecord: () => true,
    resolveAccountHome: async () => accountHome,
    recordWorkspacePath: async () => record.launchDirectory,
    agentReadsProjectModelConfig: () => false,
    probes: {
      droid: createDroidModelCatalogProbe({
        resolveEnvironment: async () => ({ PATH: '/usr/bin' }),
        resolveCommand: () => '/fixtures/droid',
        probeVersion: async () => ({ version: '1.5.0' }),
        homePath: '/fixtures',
        openConnection: () => ({ request, close: async () => {} })
      })
    }
  })
  try {
    expect(
      await service.read({
        agent: 'droid',
        sessionId: record.sessionId,
        workspacePath: record.launchDirectory,
        waitForListing: true
      })
    ).toMatchObject({
      origin: 'probe',
      models: [{ id: 'custom:saved' }, { id: 'custom:alternative' }]
    })
    expect(request).toHaveBeenCalledExactlyOnceWith('droid.list_models', {}, expect.any(Object))
  } finally {
    await service.stop()
  }
})
