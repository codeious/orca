import {
  directoryTranscriptImport,
  type StructuredAgentCliConversations
} from '../native-chat/structured-agent-cli-conversations'
import { findDroidSessionFile } from './droid-session-file'
import { parseDroidResumeArgs } from './droid-resume-grammar'

export const DROID_CLI_CONVERSATIONS: StructuredAgentCliConversations = {
  transcriptImport: directoryTranscriptImport({
    conversationStore: ({ accountHomePath }) => accountHomePath,
    accountHomeCandidates: ({ selectedAccountHomePath }) => [selectedAccountHomePath],
    findTranscript: ({ providerSessionId, store }) => findDroidSessionFile(store, providerSessionId)
  }),
  sessionHistory: {
    rowAgents: ['droid'],
    rowSessionId: (link) => link.handle.nativeId,
    parseResumeArgs: parseDroidResumeArgs
  }
}
