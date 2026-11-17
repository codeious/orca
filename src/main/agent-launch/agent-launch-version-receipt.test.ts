import { describe, expect, it } from 'vitest'
import { downgradeAgentLaunchModeForHost } from './agent-launch-mode'
import {
  isAgentLaunchResult,
  type AgentLaunchModeReceipt
} from '../../shared/agent-launch/contracts/agent-launch-intent'
import type { AgentCliInstallationProblem } from '../../shared/agent-launch/catalog/agent-cli-installation-problem'

const requested: AgentLaunchModeReceipt = {
  mode: 'structured',
  preferred: 'structured',
  reason: 'requested',
  detail: 'Started a chat.'
}

describe('version fallback receipts', () => {
  it('keeps version facts and the older-reader reason after creating a workspace', () => {
    const installation: AgentCliInstallationProblem = {
      agent: 'codex',
      installedVersion: '0.1.0',
      minimumVersion: '1.0.0'
    }
    const receipt = downgradeAgentLaunchModeForHost(
      requested,
      { supported: false, reason: 'agent', agentInstallation: installation },
      undefined,
      { phase: 'created-workspace', agent: 'codex' }
    )
    expect(receipt).toMatchObject({
      mode: 'terminal',
      preferred: 'structured',
      reason: 'structured_unsupported_on_host',
      agentInstallation: installation
    })
    expect(receipt.detail).toContain('0.1.0')
    expect(receipt.detail).toContain('1.0.0')
    expect(
      isAgentLaunchResult({
        outcome: { kind: 'terminal', handle: 'terminal-1' },
        worktreeId: 'workspace-1',
        receipt
      })
    ).toBe(true)
  })

  it('refuses an explicit chat before effects with the installed and minimum release', () => {
    expect(() =>
      downgradeAgentLaunchModeForHost(
        requested,
        {
          supported: false,
          reason: 'agent',
          agentInstallation: { agent: 'pi', installedVersion: '0.1.0', minimumVersion: '1.0.0' }
        },
        undefined,
        { phase: 'before-effects', agent: 'pi' }
      )
    ).toThrow(/0\.1\.0[\s\S]*1\.0\.0/)
  })
})
