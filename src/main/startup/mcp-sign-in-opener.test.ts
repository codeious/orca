import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const state: { mainWindow: { isDestroyed: () => boolean } | null } = { mainWindow: null }
  return { openExternal: vi.fn<(url: string) => Promise<void>>(), state }
})

vi.mock('electron', () => ({ shell: { openExternal: fake.openExternal } }))
vi.mock('./main-process-state', () => ({ mainProcessState: fake.state }))

import { openMcpSignInOnThisMachine } from './mcp-sign-in-opener'

const LINK = 'https://auth.example.invalid/authorize?state=held-in-memory'

beforeEach(() => {
  fake.openExternal.mockReset().mockResolvedValue(undefined)
  fake.state.mainWindow = { isDestroyed: () => false }
})

describe('openMcpSignInOnThisMachine', () => {
  it('opens an https link in this machine’s browser', async () => {
    await expect(openMcpSignInOnThisMachine(LINK)).resolves.toBe(true)
    expect(fake.openExternal).toHaveBeenCalledExactlyOnceWith(LINK)
  })

  it('opens nothing without a window on a headless host', async () => {
    fake.state.mainWindow = null
    await expect(openMcpSignInOnThisMachine(LINK)).resolves.toBe(false)
    expect(fake.openExternal).not.toHaveBeenCalled()
  })

  it.each(['javascript:alert(1)', 'https://user:password@auth.example.invalid'])(
    'refuses %s without opening it',
    async (raw) => {
      await expect(openMcpSignInOnThisMachine(raw)).resolves.toBe(false)
      expect(fake.openExternal).not.toHaveBeenCalled()
    }
  )
})
