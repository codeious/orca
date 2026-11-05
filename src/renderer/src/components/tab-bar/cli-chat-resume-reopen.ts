import { activateAiVaultStructuredSession } from '@/lib/activate-ai-vault-structured-session'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { CliChatResumeReopen } from './cli-chat-resume-close-admission'
import { closeCliChatResumeTerminal } from './cli-chat-resume-close-terminal'
import type { CliChatResumeSource } from './cli-chat-resume-source'
import { reportCliChatResumeTerminalChanged } from './cli-chat-resume-feedback'

export async function reopenCliChatResume(args: {
  source: CliChatResumeSource
  admission: CliChatResumeReopen
  target: RuntimeClientTarget
  signal: AbortSignal
  isCurrent: () => boolean
  prepared: () => void
  closing: () => void
}) {
  const { source, admission, target, signal, isCurrent } = args
  if (!isCurrent()) {
    return
  }
  if (admission.close !== 'keep') {
    const closed = await closeCliChatResumeTerminal(
      source,
      isCurrent,
      {
        prepared: args.prepared,
        closing: args.closing,
        refused: () => reportCliChatResumeTerminalChanged(source)
      },
      signal,
      admission.close === 'close'
    )
    if (!closed) {
      return
    }
  } else {
    args.closing()
  }
  signal.throwIfAborted()
  const { sessionId } = admission.owner
  const revealed = await callStructuredAgentSession<{ ok: boolean }>(
    target,
    'agentSession.reveal',
    { sessionId, ...(target.kind === 'environment' ? { navigation: 'caller' as const } : {}) }
  )
  if (!revealed.ok) {
    throw new Error('Could not reopen the original chat.')
  }
  const ensured = await callStructuredAgentSession<{ ok: boolean }>(target, 'agentSession.ensure', {
    sessionId
  })
  if (!ensured.ok) {
    throw new Error('Could not resume the original chat.')
  }
  await activateAiVaultStructuredSession({ structuredSession: admission.owner }, undefined, target)
}
