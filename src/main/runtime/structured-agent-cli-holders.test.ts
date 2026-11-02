import { describe, expect, it } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import type { AgentProcessVerdict } from '../../shared/agent-process-presence'
import { readCliConversationHolders } from './structured-agent-cli-writers'

const row: AgentStatusIpcPayload = {
  paneKey: 'terminal:leaf',
  worktreeId: 'folder',
  connectionId: null,
  agentType: 'droid',
  receivedAt: 1,
  stateStartedAt: 1,
  state: 'done',
  prompt: '',
  providerSession: { key: 'session_id', id: 'conversation' }
}

function read(verdict: AgentProcessVerdict | null, current = true, rows = [row]) {
  return readCliConversationHolders(
    {
      rows: () => rows,
      observation: () => ({
        current: () => current,
        presence: async () => verdict,
        topology: 'pane-owned'
      })
    },
    'droid',
    'conversation'
  )
}

describe('execution-host conversation holders', () => {
  it.each(['live', 'unverifiable', null] as const)('retains a %s writer', async (verdict) => {
    const held = verdict === 'live' ? 'live' : 'unverifiable'
    expect(await read(verdict)).toEqual({
      holder: held,
      panes: [{ paneKey: row.paneKey, verdict: held }]
    })
  })

  it('releases only a current proven exit, not a replaced row', async () => {
    expect(await read('exited')).toEqual({ holder: null, panes: [] })
    expect(await read('exited', false)).toMatchObject({ holder: 'unverifiable' })
    expect(await read('live', false)).toMatchObject({ holder: 'unverifiable' })
  })

  it('does not inspect a foreign host, another provider, or a structured projection', async () => {
    expect(
      await read('live', true, [
        { ...row, connectionId: 'ssh' },
        { ...row, agentType: 'codex' },
        { ...row, structuredHost: 'owned' },
        { ...row, providerSession: { key: 'session_id', id: 'other' } }
      ])
    ).toEqual({ holder: null, panes: [] })
  })

  it('keeps a missing or failed observation unverifiable', async () => {
    for (const observation of [
      () => null,
      () => ({
        current: () => true,
        presence: async () => {
          throw new Error('offline')
        },
        topology: 'pane-owned' as const
      })
    ]) {
      expect(
        await readCliConversationHolders(
          { rows: () => [row], observation },
          'droid',
          'conversation'
        )
      ).toMatchObject({ holder: 'unverifiable' })
    }
  })
})
