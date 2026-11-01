import { z } from 'zod'
import { AGENT_SESSION_CONVERSATION_NAME_MAX_LENGTH } from '../agent-session-conversation-name'
import {
  DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH,
  DROID_BUG_COMMENT_MAX_LENGTH,
  DROID_MCP_ARGS_MAX,
  DROID_MCP_ARG_MAX_LENGTH,
  DROID_MCP_NAME_MAX_LENGTH,
  DROID_MCP_TARGET_MAX_LENGTH,
  DROID_SKILL_NAME_MAX_LENGTH,
  DROID_WORKING_FOLDER_MAX_LENGTH
} from '../droid-host-command'
import { SessionId } from './structured-agent-session-params'

const McpServerName = z.string().min(1).max(DROID_MCP_NAME_MAX_LENGTH)
const McpTarget = z.string().min(1).max(DROID_MCP_TARGET_MAX_LENGTH)

const McpAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list') }).strict(),
  z
    .object({
      kind: z.literal('add'),
      serverName: McpServerName,
      server: z.discriminatedUnion('type', [
        z
          .object({
            type: z.literal('stdio'),
            command: McpTarget,
            args: z.array(z.string().max(DROID_MCP_ARG_MAX_LENGTH)).max(DROID_MCP_ARGS_MAX)
          })
          .strict(),
        z.object({ type: z.enum(['http', 'sse']), url: McpTarget }).strict()
      ])
    })
    .strict(),
  z.object({ kind: z.literal('toggle'), serverName: McpServerName, enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal('remove'), serverName: McpServerName }).strict(),
  z.object({ kind: z.literal('sign-in'), serverName: McpServerName }).strict()
])

/** A command the host answers from the Droid child; not a journaled mutation, so no envelope. */
export const DroidCommandParams = z
  .object({
    sessionId: SessionId,
    command: z.discriminatedUnion('name', [
      z.object({ name: z.literal('context') }).strict(),
      z.object({ name: z.literal('credits') }).strict(),
      z
        .object({
          name: z.literal('compress'),
          instructions: z.string().max(DROID_COMPRESS_INSTRUCTIONS_MAX_LENGTH).optional()
        })
        .strict(),
      z.object({ name: z.literal('fork') }).strict(),
      z
        .object({
          name: z.literal('rename'),
          title: z.string().min(1).max(AGENT_SESSION_CONVERSATION_NAME_MAX_LENGTH)
        })
        .strict(),
      z
        .object({
          name: z.literal('cwd'),
          path: z.string().min(1).max(DROID_WORKING_FOLDER_MAX_LENGTH)
        })
        .strict(),
      z
        .object({
          name: z.literal('skills'),
          toggle: z
            .object({
              skillName: z.string().min(1).max(DROID_SKILL_NAME_MAX_LENGTH),
              disabled: z.boolean()
            })
            .strict()
            .optional()
        })
        .strict(),
      z.object({ name: z.literal('mcp'), action: McpAction }).strict(),
      z
        .object({
          name: z.literal('bug'),
          userComment: z.string().max(DROID_BUG_COMMENT_MAX_LENGTH).optional()
        })
        .strict(),
      z.object({ name: z.literal('rewind'), itemId: z.string().min(1) }).strict()
    ])
  })
  .strict()
