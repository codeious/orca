import type { AgentType } from '../../../../shared/agent-status/contracts/agent-status-types'
import { resolveNativeChatTranscriptAgent } from '../../../../shared/native-chat/native-chat-agent-support'
import { decodeDroidTranscriptLine } from '../../../droid/droid-transcript-line-decoder'
import { decodeClaudeTranscriptLine } from '../../transcript-line-decoders-claude'
import { decodeCodexTranscriptLine } from '../../transcript-line-decoders-codex'
import { decodeGrokTranscriptLine } from '../../transcript-line-decoders-grok'
import { decodeOmpTranscriptLine } from '../../transcript-line-decoders-omp'
import { createReadStream } from 'node:fs'
import { decodeTranscriptStream } from '../../transcript-stream-lines'
import { readCodexLocalHistory, type CodexHistoryRecord } from '../../codex-local-history'

export async function readLegacyImportTranscript(
  input: { filePath: string; codex: boolean; roots?: readonly string[] },
  visit: (line: string, fallbackId: string, recordId?: string, selected?: boolean) => null,
  visitRecord?: (record: CodexHistoryRecord) => void
): Promise<{ consumedBytes: number }> {
  return input.codex
    ? {
        consumedBytes: await readCodexLocalHistory({
          ...input,
          visitRecord,
          visit: (line, fallbackId, selected, recordId) =>
            visit(line, fallbackId, recordId, selected)
        })
      }
    : decodeTranscriptStream(
        createReadStream(input.filePath),
        input.filePath,
        0,
        visit,
        true,
        16 * 1024 * 1024
      )
}

export const TRANSCRIPT_DECODERS = {
  claude: decodeClaudeTranscriptLine,
  codex: (line: string, fallbackId: string) =>
    decodeCodexTranscriptLine(line, fallbackId, { historyImport: true }),
  grok: decodeGrokTranscriptLine,
  omp: decodeOmpTranscriptLine,
  droid: decodeDroidTranscriptLine
} as const

export function resolveLegacyTranscriptAgent(agent: AgentType) {
  return agent === 'pi'
    ? 'omp'
    : (resolveNativeChatTranscriptAgent(agent) ??
        (isLineDecodedTranscriptAgent(agent) ? agent : null))
}

function isLineDecodedTranscriptAgent(agent: string): agent is keyof typeof TRANSCRIPT_DECODERS {
  return Object.hasOwn(TRANSCRIPT_DECODERS, agent)
}
