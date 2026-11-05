import { useSyncExternalStore } from 'react'
import { CLI_CONVERSATION_ADOPTING_AGENTS } from '../../../../shared/structured-agent-cli-conversation-adoption'
import type { CliChatResumeSource } from './cli-chat-resume-source'

export const pendingCliChatResumes = new Map<
  string,
  { controller: AbortController; source: CliChatResumeSource }
>()
const listeners = new Set<() => void>()
export const cliChatResumePendingChanged = () => listeners.forEach((listener) => listener())
export const cliChatResumePendingKey = (source: CliChatResumeSource) =>
  [
    source.executionHostId,
    CLI_CONVERSATION_ADOPTING_AGENTS[source.agent],
    source.providerSessionId
  ].join('\0')
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useCliChatResumePending(source: CliChatResumeSource | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !!source && pendingCliChatResumes.has(cliChatResumePendingKey(source)),
    () => false
  )
}
