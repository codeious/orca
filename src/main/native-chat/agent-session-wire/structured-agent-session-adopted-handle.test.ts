import { describe, expect, it } from 'vitest'
import {
  claudeProviderHandle,
  codexProviderHandle
} from '../../../shared/agent-session-provider-handle-encoding'
import { DROID_HANDLE_TRANSPORT } from '../../droid/droid-agent-definition'
import {
  adoptedProviderHandle,
  adoptedProviderHandleLink,
  agentSessionProviderHandleFromAdopted
} from './structured-agent-session-adopted-handle'

const DROID = { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: 'droid-session-1' }

describe('adopted provider handle', () => {
  // The attach fingerprint hashes this value; a different shape would stop an adopting create
  // committed before an upgrade from replaying after it.
  it('keeps the Claude and Codex wire forms byte for byte', () => {
    expect(adoptedProviderHandle(claudeProviderHandle('claude-1', 'leaf-1'))).toEqual({
      kind: 'claude',
      sessionId: 'claude-1',
      leafUuid: 'leaf-1'
    })
    expect(adoptedProviderHandle(codexProviderHandle('thread-1'))).toEqual({
      kind: 'codex',
      threadId: 'thread-1'
    })
  })

  it('carries any other agent as its typed handle and reads it back', () => {
    const adopted = adoptedProviderHandle(DROID)

    expect(adopted).toEqual({ kind: 'native', handle: DROID })
    expect(agentSessionProviderHandleFromAdopted(adopted)).toEqual(DROID)
  })

  it('reads the built-in wire forms back to the handle they came from', () => {
    for (const handle of [
      claudeProviderHandle('claude-1', null),
      codexProviderHandle('thread-1')
    ]) {
      expect(agentSessionProviderHandleFromAdopted(adoptedProviderHandle(handle))).toEqual(handle)
    }
  })

  it('opens a chain with an adopted link at fence 1 for a Droid session', () => {
    const link = adoptedProviderHandleLink(adoptedProviderHandle(DROID), 4_000)

    expect(link).toMatchObject({
      handle: DROID,
      origin: 'adopted',
      mintedAtFence: 1,
      observedAt: 4_000
    })
    expect(link.linkId).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
  })

  it('keeps the Claude adopted link identity it always had', () => {
    expect(
      adoptedProviderHandleLink(adoptedProviderHandle(claudeProviderHandle('claude-1', null)), 7)
    ).toMatchObject({
      linkId: 'claude-1-claude-1-empty',
      origin: 'adopted',
      mintedAtFence: 1,
      observedAt: 7
    })
  })
})
