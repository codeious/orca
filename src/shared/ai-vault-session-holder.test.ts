import { describe, expect, it } from 'vitest'
import { parseAiVaultSessionHolderResult } from './ai-vault-session-holder'

describe('session holder reply compatibility', () => {
  it.each([undefined, null, {}, { holder: 'exited' }, { holder: false }])(
    'never frees a malformed reply: %j',
    (reply) => {
      expect(parseAiVaultSessionHolderResult(reply)).toEqual({ holder: 'unverifiable' })
    }
  )
  it('keeps a known holder when its pane list is newer or malformed', () => {
    expect(parseAiVaultSessionHolderResult({ holder: 'live', panes: [{ future: true }] })).toEqual({
      holder: 'live'
    })
  })
  it('reads a host proof of no holders and known pane lists', () => {
    expect(parseAiVaultSessionHolderResult({ holder: null })).toEqual({ holder: null })
    expect(
      parseAiVaultSessionHolderResult({
        holder: 'live',
        panes: [{ paneKey: 'pane', verdict: 'live' }]
      })
    ).toEqual({ holder: 'live', panes: [{ paneKey: 'pane', verdict: 'live' }] })
  })
})
