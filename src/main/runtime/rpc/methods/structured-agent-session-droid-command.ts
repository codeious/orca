// A client calls this only once the host advertises `agent-session.droid-command.v1`.

import { defineMethod } from '../core'
import { requireInstalledStructuredHost } from './structured-agent-session-gate'
import { DroidCommandParams } from './structured-agent-session-schemas'

export const STRUCTURED_AGENT_SESSION_DROID_COMMAND_METHODS = [
  defineMethod({
    name: 'agentSession.droidCommand',
    permission: 'workspace',
    params: DroidCommandParams,
    handler: async (params, ctx) =>
      (await requireInstalledStructuredHost(ctx, params.sessionId)).droidCommand(
        params.sessionId,
        params.command
      )
  })
]
