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

  it.each([
    ['no window', () => (fake.state.mainWindow = null)],
    ['a destroyed window', () => (fake.state.mainWindow = { isDestroyed: () => true })]
  ])('opens nothing with %s (a headless host)', async (_label, arrange) => {
    arrange()

    await expect(openMcpSignInOnThisMachine(LINK)).resolves.toBe(false)
    expect(fake.openExternal).not.toHaveBeenCalled()
  })

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'not a url'])(
    'refuses %s without opening it',
    async (raw) => {
      await expect(openMcpSignInOnThisMachine(raw)).resolves.toBe(false)
      expect(fake.openExternal).not.toHaveBeenCalled()
    }
  )

  it('answers false and drops the message when the browser cannot be opened', async () => {
    fake.openExternal.mockRejectedValue(new Error(`cannot open ${LINK}`))

    await expect(openMcpSignInOnThisMachine(LINK)).resolves.toBe(false)
  })
})
