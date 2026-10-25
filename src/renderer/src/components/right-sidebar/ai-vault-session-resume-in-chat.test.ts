import { describe, expect, it } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import {
  aiVaultSessionCwdMatchesWorkspace,
  resolveAiVaultSessionResumeInChatEligibility
} from './ai-vault-session-resume-in-chat'

type ResumeInChatSession = Parameters<
  typeof resolveAiVaultSessionResumeInChatEligibility
>[0]['session']

const WORKSPACE_PATH = '/repo/orca'

function session(overrides: Partial<ResumeInChatSession> = {}): ResumeInChatSession {
  return {
    agent: 'claude',
    cwd: WORKSPACE_PATH,
    filePath: '/home/dev/.claude/projects/-repo-orca/session-1.jsonl',
    executionHostId: 'local',
    messageCount: 12,
    previewMessages: [],
    ...overrides
  }
}

function eligibility(
  overrides: Partial<Parameters<typeof resolveAiVaultSessionResumeInChatEligibility>[0]> = {}
) {
  return resolveAiVaultSessionResumeInChatEligibility({
    session: session(),
    targetWorkspaceId: 'repo-1::/repo/orca',
    targetWorkspacePath: WORKSPACE_PATH,
    structuredRouteAvailable: true,
    ...overrides
  })
}

describe('resolveAiVaultSessionResumeInChatEligibility', () => {
  it('offers the chat for a local Claude row in its own workspace', () => {
    expect(eligibility()).toEqual({ available: true, workspaceId: 'repo-1::/repo/orca' })
  })

  it.each(['hermes', 'grok', 'opencode'] as AiVaultSession['agent'][])(
    'refuses %s, which has no structured lane',
    (agent) => {
      expect(eligibility({ session: session({ agent }) })).toEqual({
        available: false,
        reason: 'agent'
      })
    }
  )

  it('refuses a row already adopted into a chat before any other check', () => {
    // That row reopens its own chat; a second adoption is a conflict the host would refuse.
    expect(
      eligibility({
        session: {
          ...session(),
          structuredSession: { sessionId: 'claude_1', workspaceId: 'repo-1::/repo/orca' }
        }
      })
    ).toEqual({ available: false, reason: 'already-structured' })
  })

  it('refuses a row recorded on a remote host', () => {
    expect(eligibility({ session: session({ executionHostId: 'ssh:build-box' }) })).toEqual({
      available: false,
      reason: 'remote'
    })
  })

  it('refuses a row whose transcript is stored inside WSL', () => {
    expect(
      eligibility({
        session: session({
          filePath: '//wsl.localhost/Ubuntu-22.04/home/dev/.claude/projects/p/session-1.jsonl'
        })
      })
    ).toEqual({ available: false, reason: 'remote' })
  })

  it('refuses a transcript that holds no conversation', () => {
    expect(eligibility({ session: session({ messageCount: 0, previewMessages: [] }) })).toEqual({
      available: false,
      reason: 'empty'
    })
  })

  it('offers a zero-count row whose preview proves the turns exist', () => {
    // Some parsers only learn the turn count from metadata that may be absent.
    expect(
      eligibility({
        session: session({
          messageCount: 0,
          previewMessages: [{ role: 'user', text: 'hello', timestamp: null }]
        })
      })
    ).toMatchObject({ available: true })
  })

  it('refuses when the same pair could not take the structured route for a fresh chat', () => {
    expect(eligibility({ structuredRouteAvailable: false })).toEqual({
      available: false,
      reason: 'workspace'
    })
  })

  it('refuses when there is no target workspace at all', () => {
    expect(eligibility({ targetWorkspaceId: null })).toEqual({
      available: false,
      reason: 'workspace'
    })
  })
})

describe('workspace matching, which only Claude is bound by', () => {
  it('refuses a Claude row whose conversation was recorded in another workspace', () => {
    // Claude's SDK keys transcripts by launch cwd, so resuming elsewhere silently finds nothing.
    expect(
      eligibility({
        session: session({ cwd: '/repo/other' }),
        targetWorkspacePath: WORKSPACE_PATH
      })
    ).toEqual({ available: false, reason: 'workspace' })
  })

  it('refuses a Claude row that recorded no cwd', () => {
    expect(eligibility({ session: session({ cwd: null }) })).toEqual({
      available: false,
      reason: 'workspace'
    })
  })

  it('keeps Codex available in a different workspace, and with no recorded cwd', () => {
    // Codex is handed the rollout file and a cwd, so it resumes anywhere.
    expect(eligibility({ session: session({ agent: 'codex', cwd: '/repo/other' }) })).toMatchObject(
      { available: true }
    )
    expect(eligibility({ session: session({ agent: 'codex', cwd: null }) })).toMatchObject({
      available: true
    })
  })

  it('treats Windows spellings of one directory as the same workspace', () => {
    expect(
      eligibility({
        session: session({ cwd: 'C:\\Users\\Dev\\repo\\Orca\\' }),
        targetWorkspacePath: 'c:/users/dev/repo/orca'
      })
    ).toMatchObject({ available: true })
  })
})

describe('Droid rows', () => {
  const droid = (overrides: Partial<ResumeInChatSession> = {}) =>
    session({
      agent: 'droid',
      filePath: '/home/dev/.factory/sessions/-repo-orca/session-1.jsonl',
      ...overrides
    })

  it('offers the chat for a local Droid row in its own folder that nobody holds', () => {
    expect(eligibility({ session: droid(), droidHolder: null })).toEqual({
      available: true,
      workspaceId: 'repo-1::/repo/orca'
    })
  })

  it('does not call a Droid row free before anyone has asked who holds it', () => {
    expect(eligibility({ session: droid() })).toEqual({
      available: true,
      workspaceId: 'repo-1::/repo/orca',
      confirmHeldSession: true
    })
  })

  it('refuses a Droid row recorded in another folder, or in none', () => {
    // load_session runs the tools in the recorded folder, so a chat elsewhere would edit the wrong tree.
    expect(eligibility({ session: droid({ cwd: '/repo/other' }) })).toEqual({
      available: false,
      reason: 'workspace'
    })
    expect(eligibility({ session: droid({ cwd: null }) })).toEqual({
      available: false,
      reason: 'workspace'
    })
  })

  it('refuses the same gates as every other row before it asks who holds the session', () => {
    const live = { droidHolder: 'live' as const }
    expect(eligibility({ session: droid({ executionHostId: 'ssh:build-box' }), ...live })).toEqual({
      available: false,
      reason: 'remote'
    })
    expect(eligibility({ session: droid({ messageCount: 0 }), ...live })).toEqual({
      available: false,
      reason: 'empty'
    })
    expect(eligibility({ session: droid(), structuredRouteAvailable: false, ...live })).toEqual({
      available: false,
      reason: 'workspace'
    })
  })

  it('blocks a session a live terminal holds with its own reason', () => {
    expect(eligibility({ session: droid(), droidHolder: 'live' })).toEqual({
      available: false,
      reason: 'held'
    })
  })

  it('offers an unverifiable holder only after a confirmation', () => {
    expect(eligibility({ session: droid(), droidHolder: 'unverifiable' })).toEqual({
      available: true,
      workspaceId: 'repo-1::/repo/orca',
      confirmHeldSession: true
    })
  })

  it('offers a session whose terminal exited like one nobody holds', () => {
    expect(eligibility({ session: droid(), droidHolder: null })).toEqual({
      available: true,
      workspaceId: 'repo-1::/repo/orca'
    })
  })

  it('never asks Claude or Codex rows about a holder', () => {
    expect(eligibility({ droidHolder: 'live' })).toMatchObject({ available: true })
    expect(
      eligibility({ session: session({ agent: 'codex' }), droidHolder: 'live' })
    ).toMatchObject({ available: true })
  })

  it('still sends a chat-owned Droid row to its own chat', () => {
    expect(
      eligibility({
        session: {
          ...droid(),
          structuredSession: { sessionId: 'droid_1', workspaceId: 'repo-1::/repo/orca' }
        },
        droidHolder: 'live'
      })
    ).toEqual({ available: false, reason: 'already-structured' })
  })
})

describe('aiVaultSessionCwdMatchesWorkspace', () => {
  it('ignores separator, case, and a trailing slash', () => {
    expect(aiVaultSessionCwdMatchesWorkspace('C:\\repo\\Orca', 'c:/repo/orca')).toBe(true)
    expect(aiVaultSessionCwdMatchesWorkspace('/repo/orca/', '/repo/orca')).toBe(true)
    expect(aiVaultSessionCwdMatchesWorkspace(' /repo/orca ', '/repo/orca')).toBe(true)
  })

  it('never calls a missing path a match', () => {
    expect(aiVaultSessionCwdMatchesWorkspace(null, '/repo/orca')).toBe(false)
    expect(aiVaultSessionCwdMatchesWorkspace('/repo/orca', null)).toBe(false)
    expect(aiVaultSessionCwdMatchesWorkspace('', '')).toBe(false)
  })

  it('does not treat a sibling directory as the same workspace', () => {
    expect(aiVaultSessionCwdMatchesWorkspace('/repo/orca-2', '/repo/orca')).toBe(false)
  })
})
