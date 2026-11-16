import type { AgentType } from '../../../../shared/agent-status/contracts/agent-status-types'
import { resolveNativeChatTranscriptAgent } from '../../../../shared/native-chat/native-chat-agent-support'
import { TRANSCRIPT_DECODERS } from './journal-legacy-transcript-stream'

/** The transcript dialect a legacy import reads; OMP retained Pi's format, so its decoder reads Pi. */
export function resolveLegacyTranscriptAgent(agent: AgentType) {
  return agent === 'pi'
    ? 'omp'
    : (resolveNativeChatTranscriptAgent(agent) ??
        (isLineDecodedTranscriptAgent(agent) ? agent : null))
}

function isLineDecodedTranscriptAgent(agent: string): agent is keyof typeof TRANSCRIPT_DECODERS {
  return Object.hasOwn(TRANSCRIPT_DECODERS, agent)
}
