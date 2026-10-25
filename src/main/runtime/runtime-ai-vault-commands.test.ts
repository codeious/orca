import { describe, expect, it, vi } from 'vitest'
import { RuntimeAiVaultCommands } from './runtime-ai-vault-commands'

function commandsWithHolder(
  droidSessionHolder: ((sessionId: string) => Promise<'live' | 'unverifiable' | null>) | null
): RuntimeAiVaultCommands {
  return new RuntimeAiVaultCommands(
    () => null,
    () => droidSessionHolder
  )
}

describe('RuntimeAiVaultCommands.droidSessionHolder', () => {
  it.each(['live', 'unverifiable', null] as const)(
    'relays the hook server answer %s',
    async (answer) => {
      const holder = vi.fn(async () => answer)

      await expect(commandsWithHolder(holder).droidSessionHolder('droid-session')).resolves.toBe(
        answer
      )
      expect(holder).toHaveBeenCalledWith('droid-session')
    }
  )

  it('cannot tell when this runtime has no hook server to ask', async () => {
    await expect(commandsWithHolder(null).droidSessionHolder('droid-session')).resolves.toBe(
      'unverifiable'
    )
  })

  it('cannot tell when the hook server fails to answer', async () => {
    const failing = async (): Promise<never> => {
      throw new Error('probe crashed')
    }

    await expect(commandsWithHolder(failing).droidSessionHolder('droid-session')).resolves.toBe(
      'unverifiable'
    )
  })
})
