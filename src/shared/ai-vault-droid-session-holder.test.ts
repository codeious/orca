import { describe, expect, it } from 'vitest'
import { parseAiVaultDroidSessionHolder } from './ai-vault-droid-session-holder'

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
