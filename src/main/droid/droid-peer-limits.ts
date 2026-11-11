import type { DroidPeerOptions } from './droid-json-rpc-peer'

/** Declared here, not inherited from the ACP defaults: a prompt cap and a request clock hang off them. */
export const DROID_PEER_LIMITS = {
  maxLineBytes: 16 * 1024 * 1024,
  // Each request names its own clock; none has a default.
  requestTimeoutMs: null,
  closeOnInputEnd: false
} as const satisfies DroidPeerOptions
