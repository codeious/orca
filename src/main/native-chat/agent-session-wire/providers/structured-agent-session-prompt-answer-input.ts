import type { AgentSessionPromptResponse } from '../../../../shared/agent-session/agent-session-question-answer'

export type StructuredAgentSessionPromptAnswerInput = {
  /** The answering client's operation, for providers that key their reply to it. */
  operationId?: string
  sessionId: string
  itemId: string
  kind: 'approval' | 'question'
  response: AgentSessionPromptResponse
  fence: number
  commit: () => Promise<void>
}
