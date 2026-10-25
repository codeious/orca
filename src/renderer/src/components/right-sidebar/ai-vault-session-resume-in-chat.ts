import { isAntigravityReferenceSession } from '../../../../shared/antigravity-session-origin'
// Whether an Agent Session History row can be resumed into a structured native chat, and where.
//
// Separate from `ai-vault-session-resume.ts` because the answer is not the same question: the
// terminal resume asks whether a workspace can host a PTY, this asks whether a provider will still
// find the conversation from the workspace we would run it in.

import { isWslStoredAiVaultSessionFile } from '@/lib/ai-vault-resume-target'
import { normalizeRuntimePathForComparison } from '../../../../shared/cross-platform-path'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import {
  isAgentSessionHandleProvider,
  type AgentSessionHandleProvider
} from '../../../../shared/agent-session-provider-handle'
import type { AiVaultDroidSessionHolderVerdict } from '../../../../shared/ai-vault-droid-session-holder'
import type { AiVaultOriginalPaneTarget } from './ai-vault-original-pane'
import {
  isAiVaultSessionResumableContent,
  type AiVaultSession
} from '../../../../shared/ai-vault-types'

export type AiVaultResumeInChatBlockedReason =
  | 'agent'
  | 'remote'
  | 'empty'
  | 'already-structured'
  | 'workspace'
  | 'held'

export type AiVaultResumeInChatEligibility =
  | {
      available: true
      workspaceId: string
      /** The session may still be open in a terminal Orca cannot confirm is gone. */
      confirmHeldSession?: true
    }
  | { available: false; reason: Exclude<AiVaultResumeInChatBlockedReason, 'held'> }
  | {
      available: false
      reason: 'held'
      /** The open terminal the host says holds the session, when this window can open it. */
      openTerminal?: AiVaultOriginalPaneTarget
    }

/** What a Droid terminal pane's row says about the process holding a session. `live` blocks the
 *  chat; `unverifiable` asks first. A process proven exited is not a holder, so it is not here. */
export type AiVaultDroidHolder = AiVaultDroidSessionHolderVerdict

/** The agents a history row can resume into a chat: the provider-handle agents, plus Droid. */
export type AiVaultResumeInChatAgent = AgentSessionHandleProvider | 'droid'

/**
 * Claude and Droid do not have the same freedom about *where* a conversation may be resumed as
 * Codex does.
 *
 * Codex is handed the rollout file and a cwd, so it can resume into any workspace. Claude's SDK
 * stores transcripts under a project key derived from the launch cwd, so resuming from a workspace
 * other than the one the conversation was recorded in looks in a directory the transcript is not in.
 * That is a resume that silently yields nothing, which is worse than a disabled affordance.
 *
 * Droid loads from any folder but runs a loaded session's tools in the folder it was recorded in,
 * so a chat opened elsewhere would edit a tree the person did not pick.
 */
export function aiVaultSessionResumeInChatWorkspaceMatters(
  agent: AiVaultSession['agent']
): boolean {
  return agent === 'claude' || agent === 'droid'
}

/** Droid is not a provider-handle agent (`isAgentSessionHandleProvider` stays Claude and Codex),
 *  so its chat resume is its own branch rather than a widening of that guard. */
export function aiVaultSessionHasResumeInChatBranch(
  agent: AiVaultSession['agent']
): agent is AiVaultResumeInChatAgent {
  return isAgentSessionHandleProvider(agent) || agent === 'droid'
}

/**
 * Does the row's recorded directory name the same place as the target workspace?
 *
 * Uses the shared runtime-path comparison rather than a local normalizer, which also keeps POSIX
 * paths case-SENSITIVE — folding their case would call two genuinely different directories the same.
 */
export function aiVaultSessionCwdMatchesWorkspace(
  cwd: string | null | undefined,
  workspacePath: string | null | undefined
): boolean {
  if (!cwd || !workspacePath) {
    return false
  }
  return (
    normalizeRuntimePathForComparison(cwd.trim()) ===
    normalizeRuntimePathForComparison(workspacePath.trim())
  )
}

export function resolveAiVaultSessionResumeInChatEligibility(args: {
  session: Pick<
    AiVaultSession,
    'agent' | 'cwd' | 'filePath' | 'executionHostId' | 'messageCount' | 'previewMessages'
  > & { structuredSession?: AiVaultSession['structuredSession'] }
  targetWorkspaceId: string | null
  targetWorkspacePath: string | null
  /** Whether the same (workspace, agent) pair can host a structured chat; the Chat UI switch does
   *  not apply. Reused rather than re-derived: it already encodes host capability, platform refusals
   *  and the WSL/repair refusal, and a second copy of those conditions would drift from it. */
  structuredRouteAvailable: boolean
  /** Who holds a Droid session in a terminal pane; read for Droid rows only. `null` is the host's
   *  proof that nobody does; omitted means nobody was asked, which is cannot-tell, never free. */
  droidHolder?: AiVaultDroidHolder | null
}): AiVaultResumeInChatEligibility {
  const { session } = args
  if (
    isAntigravityReferenceSession(session) ||
    !aiVaultSessionHasResumeInChatBranch(session.agent)
  ) {
    return { available: false, reason: 'agent' }
  }
  // An already-adopted row reopens its own chat instead; offering a second resume of it would ask
  // for a conflict the host would rightly refuse.
  if (session.structuredSession) {
    return { available: false, reason: 'already-structured' }
  }
  if (
    session.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
    isWslStoredAiVaultSessionFile(session.filePath)
  ) {
    return { available: false, reason: 'remote' }
  }
  if (!isAiVaultSessionResumableContent(session)) {
    return { available: false, reason: 'empty' }
  }
  if (!args.targetWorkspaceId || !args.structuredRouteAvailable) {
    return { available: false, reason: 'workspace' }
  }
  if (
    aiVaultSessionResumeInChatWorkspaceMatters(session.agent) &&
    !aiVaultSessionCwdMatchesWorkspace(session.cwd, args.targetWorkspacePath)
  ) {
    return { available: false, reason: 'workspace' }
  }
  const droidHolder =
    session.agent !== 'droid'
      ? null
      : args.droidHolder === undefined
        ? 'unverifiable'
        : args.droidHolder
  if (droidHolder === 'live') {
    return { available: false, reason: 'held' }
  }
  return {
    available: true,
    workspaceId: args.targetWorkspaceId,
    ...(droidHolder === 'unverifiable' ? { confirmHeldSession: true as const } : {})
  }
}
