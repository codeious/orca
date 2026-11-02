import { describe, expect, it } from 'vitest'
import { resolveAcpPeerOptions } from '../acp/acp-peer-limits'
import { DROID_PEER_LIMITS } from './droid-peer-limits'
import { DROID_PROMPT_MAX_BYTES } from './droid-prompt'

describe("Droid's peer limits", () => {
  it('allow 16 MiB lines, no default request clock, and leave exit to the process', () => {
    expect(resolveAcpPeerOptions({ ...DROID_PEER_LIMITS })).toEqual({
      maxLineBytes: 16 * 1024 * 1024,
      maxQueuedWriteBytes: 32 * 1024 * 1024,
      maxPendingRequests: 128,
      maxIncomingRequests: 128,
      requestTimeoutMs: null,
      closeOnInputEnd: false
    })
  })

  it('leave the stamp and envelope 64 KiB of every line a prompt cannot use', () => {
    expect(DROID_PROMPT_MAX_BYTES).toBe(DROID_PEER_LIMITS.maxLineBytes - 64 * 1024)
  })
})
