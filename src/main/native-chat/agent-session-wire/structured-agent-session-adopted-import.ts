import {
  agentSessionRefusalError,
  isAgentSessionRefusalError,
  refuse,
  type AgentSessionWireRefusal
} from '../../../shared/agent-session-wire'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { readDroidSessionStart } from '../../droid/droid-session-file'
import { agentSessionProviderHandleFromAdopted } from './structured-agent-session-adopted-handle'
import type { AgentSessionAttachParams, AttachedJournal } from './structured-agent-session-attach'
import type { JournalReplacementItem } from '../agent-session-journal/journal-epoch-replacement'
import {
  importLegacyTranscriptIntoJournal,
  prepareLegacyTranscriptImport
} from '../agent-session-journal/journal-legacy-import'

export async function prepareAdoptedTranscript(
  params: AgentSessionAttachParams
): Promise<
  | { ok: true; items: JournalReplacementItem[] | null }
  | { ok: false; refusal: AgentSessionWireRefusal }
> {
  try {
    return { ok: true, items: await readAdoptedTranscript(params) }
  } catch (error) {
    return {
      ok: false,
      refusal: isAgentSessionRefusalError(error)
        ? error.refusal
        : refuse(
            'agent_session_identity_required',
            { reason: 'transcriptUnreadable' },
            error instanceof Error ? error.message : String(error)
          )
    }
  }
}

// Validate source input before a new record can claim the provider conversation.
async function readAdoptedTranscript(
  params: AgentSessionAttachParams
): Promise<JournalReplacementItem[] | null> {
  const adopt = params.adopt
  if (!adopt) {
    return null
  }
  if (!adopt.transcriptPath) {
    throw agentSessionRefusalError('agent_session_identity_required', {
      reason: 'transcriptNotFound'
    })
  }
  const nativeId = agentSessionProviderHandleFromAdopted(adopt.providerHandle).nativeId
  const prepared = await prepareLegacyTranscriptImport({
    agent: params.agent,
    sessionId: nativeId,
    options: { filePath: adopt.transcriptPath }
  })
  if (!prepared.ok) {
    throw new Error(prepared.error)
  }
  if (
    prepared.items.length === 0 &&
    !(await isUnspokenDroidSession(params.agent, nativeId, adopt.transcriptPath))
  ) {
    throw agentSessionRefusalError('agent_session_identity_required', {
      reason: 'transcriptUnreadable'
    })
  }
  return prepared.items
}

// Only Droid files a session before its first message, as a lone `session_start` row. Its id is
// the proof the file is this conversation's; for any other agent an empty history proves nothing.
async function isUnspokenDroidSession(
  agent: AgentSessionAttachParams['agent'],
  nativeId: string,
  transcriptPath: string
): Promise<boolean> {
  return agent === 'droid' && (await readDroidSessionStart(transcriptPath))?.id === nativeId
}

// Import before publication so the first visible chat agrees with the provider's resumed context.
export async function importAdoptedTranscript(
  params: AgentSessionAttachParams,
  attached: AttachedJournal,
  record: AgentSessionRecord,
  prepared: JournalReplacementItem[] | null,
  options: { uncommittedCreate?: true } = {}
): Promise<void> {
  if (options.uncommittedCreate) {
    // A rolled-back create can leave imported history, but no conversation owns it yet.
    if (prepared?.length || attached.journal.cursor().sequence > 1) {
      await attached.journal.replaceEpochItems(
        params.adopt ? 'legacy_import' : 'session_created',
        record.lease.runtimeFence,
        prepared ?? []
      )
    }
    return
  }
  // The journal is the conversation's, which outlives a failed import; nothing here closes it.
  await applyAdoptedTranscript(params, attached, record, prepared)
}

async function applyAdoptedTranscript(
  params: AgentSessionAttachParams,
  attached: AttachedJournal,
  record: AgentSessionRecord,
  prepared: JournalReplacementItem[] | null
): Promise<void> {
  const adopt = params.adopt
  // A new journal contains only its epoch row; replay must preserve subsequent durable writes.
  if (!adopt || attached.journal.cursor().sequence > 1) {
    return
  }
  if (prepared) {
    if (prepared.length > 0) {
      await attached.journal.replaceEpochItems('legacy_import', record.lease.runtimeFence, prepared)
    }
    return
  }
  const nativeId = agentSessionProviderHandleFromAdopted(adopt.providerHandle).nativeId
  if (!adopt.transcriptPath) {
    // The founding import already wrote whatever history Droid's file held.
    if (params.agent === 'droid') {
      return
    }
    throw agentSessionRefusalError('agent_session_identity_required', {
      reason: 'transcriptNotFound'
    })
  }
  const imported = await importLegacyTranscriptIntoJournal({
    journal: attached.journal,
    agent: params.agent,
    sessionId: nativeId,
    fence: record.lease.runtimeFence,
    options: { filePath: adopt.transcriptPath }
  })
  if (!imported.ok) {
    throw new Error(imported.error)
  }
  // `replaced: false` means the transcript decoded to nothing. The row promised a conversation and
  // the provider resumed one, so an empty journal here is a disagreement, not an empty chat
  // (unless Droid filed a session nobody has spoken in).
  if (
    !imported.replaced &&
    !(await isUnspokenDroidSession(params.agent, nativeId, adopt.transcriptPath))
  ) {
    throw agentSessionRefusalError('agent_session_identity_required', {
      reason: 'transcriptUnreadable'
    })
  }
}
