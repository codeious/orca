import { describe, expect, it } from 'vitest'
import type { AiVaultDroidHoldingPane } from '../../../../shared/ai-vault-droid-session-holder'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { resolveAiVaultDroidHoldingTerminal } from './ai-vault-droid-holding-terminal'

const LEAF = '11111111-1111-4111-8111-111111111111'
const OTHER_LEAF = '22222222-2222-4222-8222-222222222222'
const PANE = makePaneKey('tab-1', LEAF)
const OTHER_PANE = makePaneKey('tab-2', OTHER_LEAF)

function tab(id: string, worktreeId = 'wt-1') {
  return {
    id,
    ptyId: null,
    worktreeId,
    title: 'Droid',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function layout(leafId: string) {
  return {
    root: { type: 'leaf' as const, leafId },
    activeLeafId: leafId,
    expandedLeafId: null,
    ptyIdsByLeafId: { [leafId]: 'pty-1' }
  }
}

const openTerminals = {
  tabsByWorktree: { 'wt-1': [tab('tab-1')], 'wt-2': [tab('tab-2', 'wt-2')] },
  terminalLayoutsByTabId: { 'tab-1': layout(LEAF), 'tab-2': layout(OTHER_LEAF) }
}

function live(paneKey: string): AiVaultDroidHoldingPane {
  return { paneKey, verdict: 'live' }
}

describe('the terminal a held Droid session can be opened in', () => {
  it('is the terminal pane the host named as holding it', () => {
    expect(
      resolveAiVaultDroidHoldingTerminal({ state: openTerminals, panes: [live(PANE)] })
    ).toEqual({
      paneKey: PANE,
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      leafId: LEAF
    })
  })

  it('is nothing when the host named no pane, as an older host does', () => {
    expect(
      resolveAiVaultDroidHoldingTerminal({ state: openTerminals, panes: undefined })
    ).toBeNull()
    expect(resolveAiVaultDroidHoldingTerminal({ state: openTerminals, panes: [] })).toBeNull()
  })

  it('is nothing when the named pane is no longer open here', () => {
    const closed = { ...openTerminals, terminalLayoutsByTabId: { 'tab-1': layout(OTHER_LEAF) } }

    expect(resolveAiVaultDroidHoldingTerminal({ state: closed, panes: [live(PANE)] })).toBeNull()
  })

  it('is nothing for a pane key that belongs to no tab here, as a paired host would name', () => {
    const remote = makePaneKey('tab-on-the-paired-host', LEAF)

    expect(
      resolveAiVaultDroidHoldingTerminal({ state: openTerminals, panes: [live(remote)] })
    ).toBeNull()
  })

  it('is nothing for a key that is not a pane key at all', () => {
    expect(
      resolveAiVaultDroidHoldingTerminal({ state: openTerminals, panes: [live('not-a-pane')] })
    ).toBeNull()
  })

  it('skips a named pane that cannot be opened for one that can', () => {
    const gone = makePaneKey('tab-closed', LEAF)

    expect(
      resolveAiVaultDroidHoldingTerminal({
        state: openTerminals,
        panes: [live(gone), live(OTHER_PANE)]
      })
    ).toMatchObject({ paneKey: OTHER_PANE, worktreeId: 'wt-2' })
  })

  it('does not open a pane that only might hold the session', () => {
    const maybe: AiVaultDroidHoldingPane = { paneKey: PANE, verdict: 'unverifiable' }

    expect(resolveAiVaultDroidHoldingTerminal({ state: openTerminals, panes: [maybe] })).toBeNull()
  })

  it('opens the pane proven live even when an unverifiable one is listed first', () => {
    const maybe: AiVaultDroidHoldingPane = { paneKey: PANE, verdict: 'unverifiable' }

    expect(
      resolveAiVaultDroidHoldingTerminal({ state: openTerminals, panes: [maybe, live(OTHER_PANE)] })
    ).toMatchObject({ paneKey: OTHER_PANE })
  })
})
