import { expect, it } from 'vitest'
import { agentSessionRecordFixture } from '../../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import { ACP_LAUNCH_SPECS } from '../../acp/acp-launch-specs'
import { acpStructuredAgentDefinition } from '../../acp/acp-structured-agent-definitions'
import { CLAUDE_STRUCTURED_AGENT } from '../../claude/structured/claude-structured-agent-definition'
import { CODEX_STRUCTURED_AGENT } from '../../codex/codex-structured-agent-definition'
import { DROID_AGENT } from '../../droid/droid-agent-definition'
import { PI_RPC_AGENT } from '../../pi/rpc-agent-definition'
import type { StructuredAgentDefinition } from './structured-agent-definition'
import { mintStructuredAgentSessionStartupAttempt } from './structured-agent-session-startup-attempt'

const saved = {
  model: 'saved-model',
  effort: 'high',
  personality: 'friendly',
  fastMode: 'true',
  serviceTier: 'fast',
  planMode: 'true',
  autonomyLevel: 'high',
  unaccepted: 'value'
}

function mint(definition: StructuredAgentDefinition, startupOptions?: Record<string, string>) {
  const record = { ...agentSessionRecordFixture(), provider: definition.agent, options: saved }
  return mintStructuredAgentSessionStartupAttempt({
    record,
    restingOptions: definition.restingOptions,
    identity: {
      sessionId: record.sessionId,
      agent: definition.agent,
      workspaceId: record.location.workspaceId,
      hostId: 'local',
      providerHandle: null
    },
    spawnToken: 'spawn',
    ...(startupOptions === undefined ? {} : { startupOptions })
  }).options
}

it.each([
  CLAUDE_STRUCTURED_AGENT,
  CODEX_STRUCTURED_AGENT,
  PI_RPC_AGENT,
  ...ACP_LAUNCH_SPECS.map(acpStructuredAgentDefinition)
])('keeps $agent message startup options unchanged', (definition) => {
  expect(mint(definition, { model: 'message-model' })).toEqual({
    ...(definition.agent === 'claude' ? { fastMode: 'false' } : {}),
    model: 'message-model'
  })
})

it('does not restore saved execution settings when a Droid message carries no picks', () => {
  expect(mint(DROID_AGENT, {})).toEqual({ planMode: 'true', autonomyLevel: 'high' })
})

it('lets explicit startup settings win over saved session settings', () => {
  expect(mint(DROID_AGENT, { planMode: 'false', autonomyLevel: 'low' })).toEqual({
    planMode: 'false',
    autonomyLevel: 'low'
  })
})

it('leaves saved options intact when startup has no message override', () => {
  expect(mint(DROID_AGENT)).toEqual(saved)
})
