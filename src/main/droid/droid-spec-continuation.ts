import { createHash } from 'node:crypto'
import { isLegacyAgentSessionAccountHome } from '../../shared/agent-session/lifecycle/agent-session-account-home'
import { computeAgentSessionPayloadFingerprint } from '../../shared/agent-session/lifecycle/agent-session-mutation-envelope'
import { DROID_AUTONOMY_OPTION_ID } from '../../shared/droid-autonomy-options'
import { AGENT_CHAT_PERMISSION_MODE_OPTION_ID } from '../../shared/agent-chat-permission-mode'
import { AgentSessionRefusalError } from '../../shared/agent-session/failures/agent-session-wire-refusals'
import type { StructuredAgentAdapterContext } from '../runtime/structured-agent-runtime-registration-types'
import { admitTranscriptPath } from '../native-chat/transcript-path-admission'
import { assertAdoptedSourceIdentity } from '../native-chat/agent-session-journal/adopted-transcript-source'
import { findDroidSessionFile, readDroidSessionStart } from './droid-session-file'
import { DROID_HANDLE_TRANSPORT } from './droid-agent-definition'
import type { DroidSpecHandoff } from './droid-spec-handoff'

export async function openDroidSpecContinuation(
  context: Pick<StructuredAgentAdapterContext, 'store' | 'host'> & {
    deps: Pick<
      StructuredAgentAdapterContext['deps'],
      'publishContinuationTab' | 'resolveWorkspacePath'
    >
  },
  sourceSessionId: string,
  handoff: DroidSpecHandoff
): Promise<void> {
  const source = context.store.getRecord(sourceSessionId)
  const host = context.host()
  const publish = context.deps.publishContinuationTab
  if (!source || !host || !publish || !isLegacyAgentSessionAccountHome(source.accountHome)) {
    throw new Error('The plan handoff host is unavailable')
  }
  const sessionId = `droid_handoff_${createHash('sha256')
    .update(`${sourceSessionId}\0${handoff.operationId}`)
    .digest('hex')
    .slice(0, 32)}`
  const fingerprint = computeAgentSessionPayloadFingerprint({
    method: 'agentSession.create',
    sessionId,
    fields: { sourceSessionId, ...handoff }
  })
  const cwd =
    source.launchDirectory ?? (await context.deps.resolveWorkspacePath(source.location.workspaceId))
  const sourceIdentity = {
    providerSessionId: handoff.newSessionId,
    workspaceCwd: cwd,
    conversationStore: source.accountHome.path
  }
  let transcriptPath: string | undefined
  if (!context.store.getRecord(sessionId)) {
    const found = await findDroidSessionFile(source.accountHome.path, handoff.newSessionId)
    const admitted = found ? await admitTranscriptPath(source.accountHome.path, found) : null
    transcriptPath = admitted?.path
    const start = transcriptPath ? await readDroidSessionStart(transcriptPath) : null
    if (!transcriptPath || !start) {
      throw new Error('Droid did not save the new plan session')
    }
    await assertAdoptedSourceIdentity(sourceIdentity, {
      sessionId: start.id,
      cwd: start.cwd ?? null
    })
  }
  const result = await host.create(
    { callerKey: 'host:provider-continuation' },
    {
      envelope: {
        sessionId,
        clientOperationId: handoff.operationId,
        expectedRuntimeFence: null,
        payloadFingerprint: fingerprint
      },
      location: source.location,
      provider: 'droid',
      agent: 'droid',
      accountHome: source.accountHome,
      runtimeKind: 'native',
      options: {
        ...source.options,
        ...(source.permissionMode
          ? { [AGENT_CHAT_PERMISSION_MODE_OPTION_ID]: source.permissionMode }
          : {}),
        planMode: 'false',
        [DROID_AUTONOMY_OPTION_ID]: handoff.autonomyLevel ?? 'off'
      },
      adopt: {
        providerHandle: {
          transport: DROID_HANDLE_TRANSPORT,
          agent: 'droid',
          nativeId: handoff.newSessionId
        },
        transcriptPath,
        source: sourceIdentity,
        allowEmpty: true
      }
    },
    {
      ...(source.launchDirectory ? { hostLaunchDirectory: source.launchDirectory } : {}),
      ...(handoff.initialPrompt
        ? {
            firstMessage: {
              clientMessageId: handoff.operationId,
              body: {
                kind: 'message',
                role: 'user',
                blocks: [{ type: 'text', text: handoff.initialPrompt }]
              }
            }
          }
        : {}),
      publishTab: () =>
        publish({ workspaceId: source.location.workspaceId, sessionId, agent: 'droid' })
    }
  )
  if (!result.ok) {
    throw new AgentSessionRefusalError(result.refusal)
  }
}
