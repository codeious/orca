import { z } from 'zod'

export const AGENT_SESSION_HOST_COMMAND_CAPABILITY = 'agent-session.host-command.v1' as const

export const AgentSessionHostCommandResultSchema = z.object({
  text: z.string().max(32_768)
})

export type AgentSessionHostCommandResult = z.infer<typeof AgentSessionHostCommandResultSchema>
