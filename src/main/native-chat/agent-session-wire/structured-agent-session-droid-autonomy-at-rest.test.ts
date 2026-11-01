// A Droid chat with no child still names the autonomy level its next start will send: the one picked
// in the chat, else the one Agent Permissions asks for. A pick made at rest is saved for that start.

import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { agentSessionRecordFixture } from '../../../shared/agent-session-record.test-fixture'
import { isAcpStructuredOptionKey } from '../../acp/acp-structured-agent-definitions'
import { CLAUDE_STRUCTURED_AGENT } from '../../claude/claude-structured-agent-definition'
import { CODEX_STRUCTURED_AGENT } from '../../codex/codex-structured-agent-definition'
import { DROID_AGENT } from '../../droid/droid-agent-definition'
import { PI_RPC_AGENT } from '../../pi/rpc-agent-definition'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-host-mutations'
import {
  readStructuredAgentSessionOptions,
  recordStructuredAgentSessionOptionIntent
} from './structured-agent-session-options-read'
import { StructuredAgentRegistry } from './structured-agent-registry'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'

function recordOf(provider: string, options: Record<string, string>): AgentSessionRecord {
  return { ...agentSessionRecordFixture(), provider, options }
}

// The registry reads only the definition here; nothing at rest reaches the adapter.
function registryOf(definition: typeof DROID_AGENT) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a resting read never calls the adapter.
  const adapter = {} as StructuredAgentSessionAdapter
  return new StructuredAgentRegistry([{ definition, adapter }])
}

async function readAtRest(options: Record<string, string>, launchArgs?: string[]) {
  const record = recordOf('droid', options)
  const resting = {
    child: null,
    params: { provider: 'droid' },
    journal: { contextUsage: () => null, context: { floor: () => null } }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resting read touches only these members.
  const context = {
    deps: {
      adapter: {},
      agents: registryOf(DROID_AGENT),
      store: { getRecord: () => record },
      modelCatalog: { read: async () => ({ origin: 'unknown' as const }) },
      ...(launchArgs ? { restingLaunchArgs: async () => launchArgs } : {})
    },
    serialize: (_sessionId: string, task: () => Promise<unknown>) => task(),
    openConversation: async () => resting,
    conversation: async () => resting
  } as unknown as StructuredAgentSessionMutationContext
  return (await readStructuredAgentSessionOptions(context, record.sessionId)).current
}

async function pick(key: string, value: string, saved: Record<string, string>) {
  const persistOptions = vi.fn(async () => {})
  const record = recordOf('droid', saved)
  const result = await recordStructuredAgentSessionOptionIntent(
    { store: { getRecord: () => record }, agents: registryOf(DROID_AGENT) },
    { sessionId: record.sessionId, persistOptions, publish: vi.fn() },
    { key, value }
  )
  return { result, persistOptions }
}

describe('the autonomy level of a Droid chat read at rest', () => {
  it('is the level picked in the chat, whatever Agent Permissions asks for', async () => {
    const current = await readAtRest({ autonomyLevel: 'low' }, ['--auto', 'high'])

    expect(current).toMatchObject({ autonomyLevel: 'low' })
  })

  it.each([
    ['Orca’s own Yolo default', ['--auto', 'high'], 'high'],
    ['an Agent Permissions level of Medium', ['--auto', 'medium'], 'medium'],
    ['the unsafe flag', ['--skip-permissions-unsafe'], 'high'],
    ['no permission argument at all', [], 'off']
  ])('is what Agent Permissions asks for when none was picked: %s', async (_name, args, level) => {
    expect(await readAtRest({ model: 'main' }, args)).toMatchObject({ autonomyLevel: level })
  })

  it('falls back to Agent Permissions when the saved level is one Droid does not define', async () => {
    expect(await readAtRest({ autonomyLevel: 'ultra' }, ['--auto', 'medium'])).toMatchObject({
      autonomyLevel: 'medium'
    })
  })

  it('names no level when the host cannot say what Agent Permissions asks for and none was picked', async () => {
    expect(await readAtRest({ model: 'main' })).not.toHaveProperty('autonomyLevel')
  })

  it('names the picked level even when the host cannot read Agent Permissions', async () => {
    expect(await readAtRest({ autonomyLevel: 'medium' })).toMatchObject({
      autonomyLevel: 'medium'
    })
  })

  it('lists no offered levels, because only a running child reports them', async () => {
    expect(await readAtRest({ autonomyLevel: 'low' }, ['--auto', 'high'])).not.toHaveProperty(
      'availableAutonomyLevels'
    )
  })

  it('leaves Spec and the pair as the saved picks say', async () => {
    expect(
      await readAtRest(
        { planMode: 'true', model: 'main', specModel: 'spec-1', autonomyLevel: 'low' },
        ['--auto', 'high']
      )
    ).toEqual({
      planMode: true,
      model: 'main',
      specModel: 'spec-1',
      autonomyLevel: 'low'
    })
  })

  it('is asked of no other agent', () => {
    for (const definition of [CLAUDE_STRUCTURED_AGENT, CODEX_STRUCTURED_AGENT, PI_RPC_AGENT]) {
      expect(definition.restingOptions).not.toHaveProperty('autonomyAtRest')
    }
  })
})

describe('an autonomy level picked at rest', () => {
  const SAVED = { planMode: 'true', model: 'main', specModel: 'spec-1' }

  it('is saved under its own key beside the other picks, for the next start to send', async () => {
    const { result, persistOptions } = await pick('autonomyLevel', 'low', SAVED)

    expect(result).toMatchObject({ ok: true })
    expect(persistOptions).toHaveBeenCalledWith({ ...SAVED, autonomyLevel: 'low' })
  })

  it('replaces the level saved before it', async () => {
    const { persistOptions } = await pick('autonomyLevel', 'off', {
      ...SAVED,
      autonomyLevel: 'high'
    })

    expect(persistOptions).toHaveBeenCalledWith({ ...SAVED, autonomyLevel: 'off' })
  })

  it('is kept off every other agent: Claude, Codex, pi and the ACP agents accept no such key', () => {
    const accepts: [string, (key: string) => boolean][] = [
      ['claude', CLAUDE_STRUCTURED_AGENT.restingOptions.acceptsKey],
      ['codex', CODEX_STRUCTURED_AGENT.restingOptions.acceptsKey],
      ['pi', PI_RPC_AGENT.restingOptions.acceptsKey],
      ['acp', (key) => isAcpStructuredOptionKey(key)]
    ]
    for (const [agent, acceptsKey] of accepts) {
      expect([agent, acceptsKey('autonomyLevel')]).toEqual([agent, false])
    }
    expect(DROID_AGENT.restingOptions.acceptsKey('autonomyLevel')).toBe(true)
  })
})
