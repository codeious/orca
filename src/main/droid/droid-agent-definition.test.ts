import { describe, expect, it } from 'vitest'
import { CLAUDE_STRUCTURED_AGENT } from '../claude/claude-structured-agent-definition'
import { CODEX_STRUCTURED_AGENT } from '../codex/codex-structured-agent-definition'
import { PI_RPC_AGENT } from '../pi/rpc-agent-definition'
import { DROID_AGENT } from './droid-agent-definition'

describe('agent capability flags', () => {
  it('lets Droid report context usage, and compacts through its own command rather than the shared one', () => {
    expect(DROID_AGENT.capabilities).toEqual({
      rewind: false,
      // Droid compacts through its own session RPC, not the shared /compact turn.
      compact: false,
      threadGoal: false,
      contextUsage: true,
      imagePrompts: false,
      steering: 'inject',
      approvalEnforcement: 'provider'
    })
  })

  it('gives Claude, Codex and pi their own rewind, compact, goal and context-usage flags', () => {
    expect(CLAUDE_STRUCTURED_AGENT.capabilities).toMatchObject({
      rewind: false,
      compact: true,
      threadGoal: false,
      contextUsage: true
    })
    expect(CODEX_STRUCTURED_AGENT.capabilities).toMatchObject({
      rewind: true,
      compact: true,
      threadGoal: true,
      contextUsage: false
    })
    expect(PI_RPC_AGENT.capabilities).toMatchObject({
      rewind: false,
      compact: true,
      threadGoal: false,
      contextUsage: true
    })
  })
})
