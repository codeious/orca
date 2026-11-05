import { randomUUID } from 'node:crypto'
import { agentSessionLeasePossiblyWriting } from '../../../../shared/agent-session/lifecycle/agent-session-lease-adjudication'
import { computeAgentSessionPayloadFingerprint } from '../../../../shared/agent-session/lifecycle/agent-session-mutation-envelope'
import { agentSessionRefusalError } from '../../../../shared/agent-session/failures/agent-session-wire-refusals'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import { listStructuredProviderSessionOwnership } from '../../../native-chat/agent-session-wire/structured-provider-session-ownership'
import {
  attachFingerprintFields,
  type AgentSessionAttachParams
} from '../../../native-chat/agent-session-wire/structured-agent-session-attach'
import { structuredAdoptionConflictError } from '../../../native-chat/structured-agent-session-history-adoption'
import type { RpcContext } from '../core'
import {
  ensureStructuredHostInstalled,
  requireStructuredSessionHost,
  structuredCallerFor
} from './structured-agent-session-gate'

export function structuredChatResumeReopen(agent: string, providerSessionId: string) {
  if (agent !== 'droid') {
    return undefined
  }
  const host = getStructuredAgentSessionHost()
  if (!host) {
    throw agentSessionRefusalError('agent_session_ownership_unknown', { reason: 'ownerUnproven' })
  }
  const owners = listStructuredProviderSessionOwnership(host.deps.store.listConversations()).filter(
    (owner) => owner.provider === agent && owner.providerSessionId === providerSessionId
  )
  const owner = owners[0]
  if (!owner) {
    return undefined
  }
  if (owner.role !== 'head' || new Set(owners.map((entry) => entry.sessionId)).size !== 1) {
    throw structuredAdoptionConflictError(owner)
  }
  if (agentSessionLeasePossiblyWriting(owner.ownerObservation)) {
    throw agentSessionRefusalError('agent_session_ownership_unknown', { reason: 'ownerUnproven' })
  }
  return { sessionId: owner.sessionId, workspaceId: owner.workspaceId }
}

/** Resolve existing identity on its host; clients cannot choose account, handle, or founding defaults. */
export async function ensureReopenedStructuredSession(sessionId: string, ctx: RpcContext) {
  await ensureStructuredHostInstalled(ctx)
  const host = requireStructuredSessionHost(ctx, sessionId)
  const record = host.deps.store.requireWritableRecord(sessionId)
  if (record.provider !== 'droid') {
    throw agentSessionRefusalError('structured_agent_session_unsupported', {
      reason: 'hostUnsupported'
    })
  }
  const head = record.providerHandleChain.at(-1)
  if (!head) {
    throw agentSessionRefusalError('agent_session_identity_required', { reason: 'recordMissing' })
  }
  const expectedRuntimeFence = record.lease.runtimeFence
  const requireOwner = () => {
    const owner = structuredChatResumeReopen(record.provider, head.handle.nativeId)
    if (owner?.sessionId !== sessionId) {
      throw agentSessionRefusalError('agent_session_identity_required', { reason: 'recordMissing' })
    }
  }
  requireOwner()
  await ctx.runtime.assertStructuredAdoptionTerminalWritersExited(
    record.provider,
    head.handle.nativeId
  )
  requireOwner()
  const params: AgentSessionAttachParams = {
    envelope: {
      sessionId,
      clientOperationId: randomUUID(),
      expectedRuntimeFence,
      payloadFingerprint: ''
    },
    location: record.location,
    provider: record.provider,
    agent: record.provider,
    accountHome: record.accountHome,
    runtimeKind: 'native'
  }
  params.envelope.payloadFingerprint = computeAgentSessionPayloadFingerprint({
    method: 'agentSession.attach',
    sessionId,
    fields: attachFingerprintFields(params)
  })
  return host.attach(structuredCallerFor(ctx), params)
}
