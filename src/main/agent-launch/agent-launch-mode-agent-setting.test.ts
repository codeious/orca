import { describe, expect, it } from 'vitest'
import {
  decideAgentLaunchMode,
  downgradeAgentLaunchModeForHost,
  type AgentLaunchModeSettings
} from './agent-launch-mode'

const droid = { agent: 'droid', workspaceKind: 'git-worktree' } as const
const switchOn: AgentLaunchModeSettings = { experimentalNativeChat: true }
const switchOff: AgentLaunchModeSettings = { experimentalNativeChat: false }

function withDroid(
  base: AgentLaunchModeSettings,
  preference: 'terminal' | 'chat'
): AgentLaunchModeSettings {
  return { ...base, agentLaunchModes: { droid: preference } }
}

describe('a per-agent launch setting', () => {
  it('Terminal keeps Droid in a terminal while the switch is on', () => {
    expect(
      decideAgentLaunchMode({ placement: droid, settings: withDroid(switchOn, 'terminal') })
    ).toMatchObject({ mode: 'terminal', preferred: 'terminal', reason: 'agent_setting' })
  })

  it('Chat opens a structured Droid session while the switch is off', () => {
    expect(
      decideAgentLaunchMode({ placement: droid, settings: withDroid(switchOff, 'chat') })
    ).toMatchObject({ mode: 'structured', preferred: 'structured', reason: 'agent_setting' })
  })

  it('names the setting rather than the default in what it tells the person', () => {
    const { detail } = decideAgentLaunchMode({
      placement: droid,
      settings: withDroid(switchOff, 'chat')
    })
    expect(detail).toContain('launch setting for this agent')
    expect(detail).not.toContain('default for new agent tabs')
  })

  it('Follow reads the switch, with the receipt the switch always gave', () => {
    expect(decideAgentLaunchMode({ placement: droid, settings: switchOn })).toMatchObject({
      mode: 'structured',
      reason: 'user_default'
    })
    expect(decideAgentLaunchMode({ placement: droid, settings: switchOff })).toMatchObject({
      mode: 'terminal',
      preferred: 'terminal',
      reason: 'user_default'
    })
  })

  it('leaves every other agent on the switch', () => {
    expect(
      decideAgentLaunchMode({
        placement: { agent: 'claude', workspaceKind: 'git-worktree' },
        settings: withDroid(switchOff, 'chat')
      })
    ).toMatchObject({ mode: 'terminal', reason: 'user_default' })
    expect(
      decideAgentLaunchMode({
        placement: { agent: 'claude', workspaceKind: 'git-worktree' },
        settings: withDroid(switchOn, 'terminal')
      })
    ).toMatchObject({ mode: 'structured', reason: 'user_default' })
  })

  it('does not reach a caller whose contract is a terminal handle', () => {
    expect(
      decideAgentLaunchMode({
        placement: droid,
        settings: withDroid(switchOff, 'chat'),
        terminalOnly: true
      })
    ).toMatchObject({ mode: 'terminal', preferred: 'terminal' })
  })
})

describe('Chat for an agent that cannot be a chat here', () => {
  const chat = withDroid(switchOff, 'chat')

  it.each([
    ['a remote execution host', { ...droid, on: 'server-1' }, 'remote_execution_host'],
    ['a reused terminal', { ...droid, terminal: 'term_1' }, 'reused_terminal'],
    [
      'a custom start directory',
      { ...droid, workspacePath: '/repo', cwd: '/elsewhere' },
      'tui_launch_command'
    ],
    [
      'a caller that cannot show it',
      { ...droid, callerRendersStructured: false },
      'structured_sessions_unavailable'
    ]
  ] as const)('keeps its terminal and reason for %s', (_name, placement, reason) => {
    const receipt = decideAgentLaunchMode({ placement, settings: chat })
    expect(receipt).toMatchObject({ mode: 'terminal', preferred: 'structured', reason })
    expect(receipt.detail).toMatch(/^Your launch setting for this agent is Chat, but /)
  })

  it('keeps the switch wording when the switch is what asked for the chat', () => {
    const receipt = decideAgentLaunchMode({
      placement: { ...droid, on: 'server-1' },
      settings: switchOn
    })
    expect(receipt.detail).toMatch(/^Your default is a structured chat session, but /)
  })

  it.each([
    ['wsl', { supported: false, reason: 'wsl' } as const, 'wsl_execution_runtime'],
    ['remote', { supported: false, reason: 'remote' } as const, 'remote_execution_host'],
    ['agent', { supported: false, reason: 'agent' } as const, 'structured_unsupported_on_host'],
    ['no answer', null, 'structured_support_unknown']
  ])('keeps the host verdict %s and names the setting', (_name, support, reason) => {
    const chosen = decideAgentLaunchMode({ placement: droid, settings: chat })
    const receipt = downgradeAgentLaunchModeForHost(chosen, support)
    expect(receipt).toMatchObject({ mode: 'terminal', preferred: 'structured', reason })
    expect(receipt.detail).toMatch(/^Your launch setting for this agent is Chat, but /)
  })

  it('keeps the version receipt for a Droid below the floor', () => {
    const chosen = decideAgentLaunchMode({ placement: droid, settings: chat })
    const receipt = downgradeAgentLaunchModeForHost(chosen, {
      supported: false,
      reason: 'agent',
      unsupportedVersion: {
        agentName: 'Droid',
        found: '0.230.0',
        floor: '0.238.0',
        updateCommand: 'droid update'
      }
    })
    expect(receipt).toMatchObject({
      mode: 'terminal',
      preferred: 'structured',
      reason: 'agent_version_unsupported'
    })
  })
})
