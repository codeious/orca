import type {
  AiVaultPrepareSessionResumeArgs,
  AiVaultPrepareSessionResumeResult
} from '../../shared/ai-vault-resume-preparation'
import {
  AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL_RESULT,
  type AiVaultDroidSessionHolderResult
} from '../../shared/ai-vault-droid-session-holder'
import type {
  AiVaultSessionTitleRequest,
  AiVaultSessionTitlesResult
} from '../../shared/ai-vault-session-title'
import type { AiVaultListArgs, AiVaultListResult } from '../../shared/ai-vault-types'
import { listAiVaultSessions } from '../ai-vault/cached-session-list'
import { resolveLocalAiVaultSessionTitles } from '../ai-vault/session-title-resolver'

export class RuntimeAiVaultCommands {
  constructor(
    private readonly getPrepareResume: () =>
      | ((args: AiVaultPrepareSessionResumeArgs) => Promise<AiVaultPrepareSessionResumeResult>)
      | null,
    private readonly getDroidSessionHolder: () =>
      | ((sessionId: string) => Promise<AiVaultDroidSessionHolderResult>)
      | null
  ) {}

  /** A runtime without a hook server, or whose probe fails, cannot tell: that is not "free". */
  async droidSessionHolder(sessionId: string): Promise<AiVaultDroidSessionHolderResult> {
    const read = this.getDroidSessionHolder()
    if (!read) {
      return AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL_RESULT
    }
    try {
      return await read(sessionId)
    } catch {
      return AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL_RESULT
    }
  }

  list(args?: AiVaultListArgs): Promise<AiVaultListResult> {
    return listAiVaultSessions(args)
  }

  resolveTitles(
    requests: AiVaultSessionTitleRequest[],
    signal?: AbortSignal
  ): Promise<AiVaultSessionTitlesResult> {
    return resolveLocalAiVaultSessionTitles(requests, signal)
  }

  prepare(args: AiVaultPrepareSessionResumeArgs): Promise<AiVaultPrepareSessionResumeResult> {
    return this.getPrepareResume()?.(args) ?? Promise.resolve({ useRealCodexHome: false })
  }
}
