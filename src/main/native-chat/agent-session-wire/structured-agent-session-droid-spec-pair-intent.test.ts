// A Spec model or effort picked while the chat has no child is saved for the next start; clearing
// one removes it, since a saved "same as main" would start Droid on a model that does not exist.

import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { agentSessionRecordFixture } from '../../../shared/agent-session-record.test-fixture'
import { DROID_SPEC_SAME_AS_MAIN } from '../../../shared/droid-spec-pair-options'
import { isAcpStructuredOptionKey } from '../../acp/acp-structured-agent-definitions'
import { CLAUDE_STRUCTURED_AGENT } from '../../claude/claude-structured-agent-definition'
import { CODEX_STRUCTURED_AGENT } from '../../codex/codex-structured-agent-definition'
import { DROID_AGENT } from '../../droid/droid-agent-definition'
import { PI_RPC_AGENT } from '../../pi/rpc-agent-definition'
import { StructuredAgentRegistry } from './structured-agent-registry'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { recordStructuredAgentSessionOptionIntent } from './structured-agent-session-options-read'

const SAVED = {
  planMode: 'true',
  model: 'main',
  effort: 'low',
  specModel: 'spec-1',
  specEffort: 'high'
}

function recordOf(provider: string, options: Record<string, string>): AgentSessionRecord {
  return { ...agentSessionRecordFixture(), provider, options }
}

// The registry reads only the definition here; no pick reaches the adapter.
function registryOf(definition: typeof DROID_AGENT) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: an at-rest pick never calls the adapter.
  const adapter = {} as StructuredAgentSessionAdapter
  return new StructuredAgentRegistry([{ definition, adapter }])
}

async function pick(key: string, value: string) {
  const persistOptions = vi.fn(async () => {})
  const record = recordOf('droid', SAVED)
  const result = await recordStructuredAgentSessionOptionIntent(
    { store: { getRecord: () => record }, agents: registryOf(DROID_AGENT) },
    { sessionId: record.sessionId, persistOptions, publish: vi.fn() },
    { key, value }
  )
  return { result, persistOptions }
}

describe('a Droid Spec model or effort picked at rest', () => {
  it('is saved under its own key beside the main pair', async () => {
    const { result, persistOptions } = await pick('specModel', 'spec-2')

    expect(result).toMatchObject({ ok: true })
    expect(persistOptions).toHaveBeenCalledWith({ ...SAVED, specModel: 'spec-2' })
  })

  it('is removed with its effort when the model is cleared, and the main pair stays', async () => {
    const { result, persistOptions } = await pick('specModel', DROID_SPEC_SAME_AS_MAIN)

    expect(result).toMatchObject({
      ok: true,
      value: { options: { planMode: 'true', model: 'main', effort: 'low' } }
    })
    expect(persistOptions).toHaveBeenCalledWith({ planMode: 'true', model: 'main', effort: 'low' })
  })

  it('is removed alone when the effort is cleared', async () => {
    const { persistOptions } = await pick('specEffort', DROID_SPEC_SAME_AS_MAIN)

    expect(persistOptions).toHaveBeenCalledWith({
      planMode: 'true',
      model: 'main',
      effort: 'low',
      specModel: 'spec-1'
    })
  })

  it('is kept off every other agent: Claude, Codex, pi and the ACP agents accept neither key', () => {
    const acpKey = (key: string) => isAcpStructuredOptionKey(key)
    const accepts: [string, (key: string) => boolean][] = [
      ['claude', CLAUDE_STRUCTURED_AGENT.restingOptions.acceptsKey],
      ['codex', CODEX_STRUCTURED_AGENT.restingOptions.acceptsKey],
      ['pi', PI_RPC_AGENT.restingOptions.acceptsKey],
      ['acp', acpKey]
    ]
    for (const [agent, acceptsKey] of accepts) {
      expect([agent, acceptsKey('specModel')]).toEqual([agent, false])
      expect([agent, acceptsKey('specEffort')]).toEqual([agent, false])
    }
    expect(DROID_AGENT.restingOptions.acceptsKey('specModel')).toBe(true)
    expect(DROID_AGENT.restingOptions.acceptsKey('specEffort')).toBe(true)
  })
})
