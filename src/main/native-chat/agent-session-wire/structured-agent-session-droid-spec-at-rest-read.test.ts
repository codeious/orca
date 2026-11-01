// A Droid chat with no child still names the Spec it will start in, so reading its options at rest
// neither drops a Spec pick nor takes the Spec row away.

import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { agentSessionRecordFixture } from '../../../shared/agent-session-record.test-fixture'
import { CLAUDE_STRUCTURED_AGENT } from '../../claude/claude-structured-agent-definition'
import { CODEX_STRUCTURED_AGENT } from '../../codex/codex-structured-agent-definition'
import { DROID_AGENT } from '../../droid/droid-agent-definition'
import { PI_RPC_AGENT } from '../../pi/rpc-agent-definition'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-host-mutations'
import { readStructuredAgentSessionOptions } from './structured-agent-session-options-read'
import { StructuredAgentRegistry } from './structured-agent-registry'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'

function recordOf(options: Record<string, string>): AgentSessionRecord {
  return { ...agentSessionRecordFixture(), provider: 'droid', options }
}

async function readAtRest(options: Record<string, string>) {
  const record = recordOf(options)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a resting read never reaches the adapter.
  const adapter = {} as StructuredAgentSessionAdapter
  const resting = {
    child: null,
    params: { provider: 'droid' },
    journal: { contextUsage: () => null, context: { floor: () => null } }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resting read touches only these members.
  const context = {
    deps: {
      adapter,
      agents: new StructuredAgentRegistry([{ definition: DROID_AGENT, adapter }]),
      store: { getRecord: () => record },
      modelCatalog: { read: async () => ({ origin: 'unknown' as const }) }
    },
    serialize: (_sessionId: string, task: () => Promise<unknown>) => task(),
    openConversation: async () => resting,
    conversation: async () => resting
  } as unknown as StructuredAgentSessionMutationContext
  return (await readStructuredAgentSessionOptions(context, record.sessionId)).current
}

describe('a Droid chat read at rest', () => {
  it('reports Spec on and the pair it will run on, beside the main pair', async () => {
    expect(
      await readAtRest({
        planMode: 'true',
        model: 'main',
        effort: 'low',
        specModel: 'spec-1',
        specEffort: 'high'
      })
    ).toEqual({
      planMode: true,
      model: 'main',
      effort: 'low',
      specModel: 'spec-1',
      specEffort: 'high'
    })
  })

  it('reports Spec off when none is saved, so the row stays until a child answers', async () => {
    expect(await readAtRest({ model: 'main' })).toEqual({
      planMode: false,
      model: 'main'
    })
  })

  it('reports Spec off when the saved pick is off', async () => {
    expect(await readAtRest({ planMode: 'false' })).toEqual({
      planMode: false
    })
  })

  it('reports no pair that was cleared', async () => {
    expect(await readAtRest({ planMode: 'true', model: 'main' })).toEqual({
      planMode: true,
      model: 'main'
    })
  })

  it('is asked of no other agent', () => {
    for (const definition of [CLAUDE_STRUCTURED_AGENT, CODEX_STRUCTURED_AGENT, PI_RPC_AGENT]) {
      expect(definition.restingOptions).not.toHaveProperty('reportsSavedSpec')
    }
    expect(DROID_AGENT.restingOptions.reportsSavedSpec).toBe(true)
  })
})
