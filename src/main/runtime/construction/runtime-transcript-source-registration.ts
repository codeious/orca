import { configureAiVaultSessionSources } from '../../ai-vault/cached-session-list'

import { configureHostReadableTranscriptPathSources } from '../../native-chat/host-readable-transcript-path'

import type { RuntimeConstructionDependencies } from './runtime-construction-dependencies'

export function registerRuntimeTranscriptSources(
  deps?: Pick<RuntimeConstructionDependencies, 'getAdditionalAiVaultCodexHomePaths'>
): void {
  // Headless serve skips registerCoreHandlers but still needs managed-Codex/WSL AiVault sources.
  if (deps?.getAdditionalAiVaultCodexHomePaths) {
    configureAiVaultSessionSources({
      getAdditionalCodexHomePaths: deps.getAdditionalAiVaultCodexHomePaths
    })
    configureHostReadableTranscriptPathSources({
      getAdditionalCodexHomePaths: deps.getAdditionalAiVaultCodexHomePaths
    })
  }
}
