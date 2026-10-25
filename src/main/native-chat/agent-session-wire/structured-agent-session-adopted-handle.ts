import type {
  AgentSessionProviderHandle,
  AgentSessionProviderHandleLink
} from '../../../shared/agent-session-provider-handle'
import {
  agentSessionProviderHandleFromWire,
  agentSessionWireProviderHandle,
  type AgentSessionWireProviderHandle
} from '../../../shared/agent-session-provider-handle-encoding'
import { claudeProviderHandleLink } from '../../claude/claude-structured-owner-identity'
import { codexProviderHandleLink } from '../../codex/codex-structured-owner-identity'

/**
 * The conversation an adopting create resumes. Claude and Codex keep their wire forms, because the
 * attach fingerprint hashes them as sent and a committed create must replay across an upgrade. Any
 * other agent carries its typed handle; `adopt` is host-resolved, so no client ever supplies one.
 */
export type AdoptedProviderHandle =
  | AgentSessionWireProviderHandle
  | { kind: 'native'; handle: AgentSessionProviderHandle }

export function adoptedProviderHandle(handle: AgentSessionProviderHandle): AdoptedProviderHandle {
  return agentSessionWireProviderHandle(handle) ?? { kind: 'native', handle }
}

export function agentSessionProviderHandleFromAdopted(
  adopted: AdoptedProviderHandle
): AgentSessionProviderHandle {
  return adopted.kind === 'native' ? adopted.handle : agentSessionProviderHandleFromWire(adopted)
}

/**
 * Fence 1 is a new record's first, and the owner probe requires the head link to carry the
 * record's current fence.
 */
const ADOPTED_HANDLE_FENCE = 1

/**
 * An adoption names a conversation this session did not create, so its link says `adopted`. The
 * adapter appends its own `resumed` link once the provider proves the same identity root.
 */
export function adoptedProviderHandleLink(
  adopted: AdoptedProviderHandle,
  observedAt: number
): AgentSessionProviderHandleLink {
  if (adopted.kind === 'native') {
    const { handle } = adopted
    return {
      linkId: `${handle.agent}-${ADOPTED_HANDLE_FENCE}-${handle.nativeId}`
        .replaceAll(/[^A-Za-z0-9_-]/g, '_')
        .slice(0, 128),
      handle,
      origin: 'adopted',
      mintedAtFence: ADOPTED_HANDLE_FENCE,
      observedAt
    }
  }
  return adopted.kind === 'claude'
    ? claudeProviderHandleLink({
        sessionId: adopted.sessionId,
        leafUuid: adopted.leafUuid,
        resumed: false,
        origin: 'adopted',
        fence: ADOPTED_HANDLE_FENCE,
        observedAt
      })
    : codexProviderHandleLink({
        threadId: adopted.threadId,
        resumed: false,
        origin: 'adopted',
        fence: ADOPTED_HANDLE_FENCE,
        observedAt
      })
}
