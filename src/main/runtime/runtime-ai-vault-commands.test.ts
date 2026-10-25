import { describe, expect, it, vi } from 'vitest'
import type { AiVaultDroidSessionHolderResult } from '../../shared/ai-vault-droid-session-holder'
import { RuntimeAiVaultCommands } from './runtime-ai-vault-commands'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

function commandsWithHolder(
  droidSessionHolder: ((sessionId: string) => Promise<AiVaultDroidSessionHolderResult>) | null
): RuntimeAiVaultCommands {
  return new RuntimeAiVaultCommands(
    () => null,
    () => droidSessionHolder
  )
}

describe('RuntimeAiVaultCommands.droidSessionHolder', () => {
  it.each<AiVaultDroidSessionHolderResult>([
    { holder: 'live', panes: [{ paneKey: PANE_KEY, verdict: 'live' }] },
    { holder: 'unverifiable', panes: [{ paneKey: PANE_KEY, verdict: 'unverifiable' }] },
    { holder: null, panes: [] },
    { holder: 'live' }
  ])('relays the hook server answer %j, panes and all', async (answer) => {
    const holder = vi.fn(async () => answer)

    await expect(commandsWithHolder(holder).droidSessionHolder('droid-session')).resolves.toEqual(
      answer
    )
    expect(holder).toHaveBeenCalledWith('droid-session')
  })

  it('cannot tell when this runtime has no hook server to ask', async () => {
    await expect(commandsWithHolder(null).droidSessionHolder('droid-session')).resolves.toEqual({
      holder: 'unverifiable'
    })
  })

  it('cannot tell when the hook server fails to answer', async () => {
    const failing = async (): Promise<never> => {
      throw new Error('probe crashed')
    }

    await expect(commandsWithHolder(failing).droidSessionHolder('droid-session')).resolves.toEqual({
      holder: 'unverifiable'
    })
  })
})
