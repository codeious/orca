import '../unused-default-rpc-methods.test-fixture'
import { afterEach, expect, it } from 'vitest'
import { mobileRuntimeClientCapabilityUpdateRequest } from '../../../../../mobile/src/transport/mobile-runtime-client-capabilities'
import { AGENT_SESSION_SESSION_OPTIONS_CAPABILITY } from '../../../../shared/agent-session/options/agent-session-session-options'
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../../../shared/electron-remote-runtime-client-capabilities'
import { WEB_RUNTIME_CLIENT_CAPABILITIES } from '../../../../shared/web-runtime-client-capabilities'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import { DROID_AGENT, DROID_ACCOUNT_HOME_VARIABLE } from '../../../droid/droid-agent-definition'
import { DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES } from '../../../ipc/desktop-renderer-runtime-capabilities'
import {
  runDroidRigCleanups,
  setupDroidAdapter
} from '../../../droid/droid-adapter-rig.test-support'
import { StructuredAgentRegistry } from '../../../native-chat/agent-session-wire/structured-agent-registry'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import { seedTestAgentSessionRecordStore } from '../../agent-session/records/agent-session-record-store-test-harness'
import { parseRuntimeClientCapabilities } from '../runtime-client-capabilities'
import { call, fixture } from './structured-agent-session-rest-contract-test-fixture'

afterEach(runDroidRigCleanups)

const readers = [
  {
    name: 'mobile',
    clientKind: 'mobile',
    advertised: mobileRuntimeClientCapabilityUpdateRequest({
      id: 'capabilities',
      deviceToken: 'phone'
    }).params.clientCapabilities
  },
  {
    name: 'local desktop',
    clientKind: 'runtime',
    advertised: DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES
  },
  {
    name: 'remote desktop',
    clientKind: 'runtime',
    advertised: ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES
  },
  {
    name: 'browser',
    clientKind: 'runtime',
    advertised: WEB_RUNTIME_CLIENT_CAPABILITIES
  }
] as const

it.each(readers)('delivers Droid permissions through the $name handshake', async (reader) => {
  const droid = await setupDroidAdapter()
  const record = {
    ...agentSessionRecordFixture(
      agentSessionLeaseFixture({
        claimStatus: 'released',
        ownerProcess: null,
        provenHandleLinkId: null,
        reservedSpawnToken: null
      })
    ),
    provider: 'droid',
    providerHandleChain: [],
    accountHome: { variable: DROID_ACCOUNT_HOME_VARIABLE, path: '/home/user' },
    options: { autonomyLevel: 'medium' }
  }
  await seedTestAgentSessionRecordStore(fixture.rig.root, { records: [record] })
  setStructuredAgentSessionHost(
    await fixture.rig.restart({
      agents: new StructuredAgentRegistry([{ definition: DROID_AGENT, adapter: droid.adapter }])
    })
  )
  const client = {
    clientKind: reader.clientKind,
    clientCapabilities: parseRuntimeClientCapabilities([...reader.advertised])
  }
  const [options] = await call('agentSession.options', { sessionId: record.sessionId }, client)
  expect(options).toMatchObject({
    ok: true,
    result: {
      sessionOptions: expect.arrayContaining([
        expect.objectContaining({
          id: 'autonomyLevel',
          scope: 'session',
          valueSource: 'applied',
          settable: true,
          kind: expect.objectContaining({ type: 'select', currentValue: 'medium' })
        })
      ])
    }
  })

  const [legacy] = await call(
    'agentSession.options',
    { sessionId: record.sessionId },
    {
      ...client,
      clientCapabilities: client.clientCapabilities.filter(
        (capability) => capability !== AGENT_SESSION_SESSION_OPTIONS_CAPABILITY
      )
    }
  )
  expect(legacy).toMatchObject({ ok: true })
  if (legacy?.ok) {
    expect(legacy.result).not.toHaveProperty('sessionOptions')
  }
  expect(droid.openConnection).not.toHaveBeenCalled()
})
