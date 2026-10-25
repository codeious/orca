import { describe, expect, it } from 'vitest'
import {
  parseAiVaultDroidSessionHolder,
  parseAiVaultDroidSessionHolderResult
} from './ai-vault-droid-session-holder'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

describe('parseAiVaultDroidSessionHolder', () => {
  it('passes through the three answers a host can give', () => {
    expect(parseAiVaultDroidSessionHolder({ holder: 'live' })).toBe('live')
    expect(parseAiVaultDroidSessionHolder({ holder: 'unverifiable' })).toBe('unverifiable')
    expect(parseAiVaultDroidSessionHolder({ holder: null })).toBeNull()
  })

  it.each([
    ['no body', undefined],
    ['a null body', null],
    ['an empty object', {}],
    ['a missing holder key', { other: 'live' }],
    ['a proven-exited verdict, which is not a holder', { holder: 'exited' }],
    ['a synonym for free', { holder: 'free' }],
    ['a boolean', { holder: false }],
    ['a bare string', 'live']
  ])('reads %s as cannot-tell, never as a free session', (_label, reply) => {
    expect(parseAiVaultDroidSessionHolder(reply)).toBe('unverifiable')
  })
})

describe('parseAiVaultDroidSessionHolderResult', () => {
  it('keeps the panes the host names, each with its own verdict', () => {
    const panes = [
      { paneKey: PANE_KEY, verdict: 'live' },
      { paneKey: 'tab-2:22222222-2222-4222-8222-222222222222', verdict: 'unverifiable' }
    ]
    expect(parseAiVaultDroidSessionHolderResult({ holder: 'live', panes })).toStrictEqual({
      holder: 'live',
      panes
    })
  })

  it('reads a host that predates panes as holding, with no pane named', () => {
    // Absent is "cannot tell which pane"; an empty list would claim the host looked and found none.
    expect(parseAiVaultDroidSessionHolderResult({ holder: 'live' })).toStrictEqual({
      holder: 'live'
    })
    expect(parseAiVaultDroidSessionHolderResult({ holder: 'unverifiable' })).toStrictEqual({
      holder: 'unverifiable'
    })
  })

  it('still frees the session only on an explicit null', () => {
    expect(parseAiVaultDroidSessionHolderResult({ holder: null })).toStrictEqual({ holder: null })
  })

  it('never lets a free answer carry a pane to open', () => {
    const panes = [{ paneKey: PANE_KEY, verdict: 'live' }]
    expect(parseAiVaultDroidSessionHolderResult({ holder: null, panes })).toStrictEqual({
      holder: null
    })
  })

  it.each([
    ['panes that are not a list', 'nope'],
    ['a pane with no key', [{ verdict: 'live' }]],
    ['a pane with an empty key', [{ paneKey: '', verdict: 'live' }]],
    ['a pane proven exited, which holds nothing', [{ paneKey: PANE_KEY, verdict: 'exited' }]],
    ['a pane with a synonym for live', [{ paneKey: PANE_KEY, verdict: 'running' }]],
    [
      'one good pane beside one bad one',
      [
        { paneKey: PANE_KEY, verdict: 'live' },
        { paneKey: PANE_KEY, verdict: 'free' }
      ]
    ]
  ])('keeps the holder and drops every pane when it gets %s', (_label, panes) => {
    expect(parseAiVaultDroidSessionHolderResult({ holder: 'live', panes })).toStrictEqual({
      holder: 'live'
    })
  })

  it.each([
    ['no body', undefined],
    ['a null body', null],
    ['an empty object', {}],
    ['a synonym for free', { holder: 'free', panes: [{ paneKey: PANE_KEY, verdict: 'live' }] }],
    ['a bare string', 'live']
  ])('reads %s as cannot-tell with no pane, never as free', (_label, reply) => {
    expect(parseAiVaultDroidSessionHolderResult(reply)).toStrictEqual({ holder: 'unverifiable' })
  })
})
