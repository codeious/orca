import { DroidRpcError } from './droid-rpc-errors'

const METHOD_NOT_FOUND = -32601

/** Only the code is read: an older Droid words the message differently. */
export function isDroidMethodNotFound(error: unknown): error is DroidRpcError {
  return error instanceof DroidRpcError && error.code === METHOD_NOT_FOUND
}

export function needsNewerDroidSentence(action: string): string {
  return `${action} needs a newer Droid. Update Droid and try again.`
}

/** A method left out keeps Droid's own error: `droid.close_session` is one, as before. */
const ACTIONS: Readonly<Record<string, string>> = {
  'droid.compact_session': 'Compacting the conversation',
  'droid.fork_session': 'Forking the conversation',
  'droid.get_rewind_info': 'Rewinding the conversation',
  'droid.execute_rewind': 'Rewinding the conversation',
  'droid.rename_session': 'Renaming the conversation',
  'droid.get_context_stats': 'Showing context usage',
  'droid.get_context_breakdown': 'Showing context usage',
  'droid.change_working_directory': 'Changing the working folder',
  'droid.list_skills': 'Listing skills',
  'droid.set_skill_disabled': 'Turning a skill on or off',
  'droid.list_mcp_servers': 'Listing MCP servers',
  'droid.add_mcp_server': 'Adding an MCP server',
  'droid.remove_mcp_server': 'Removing an MCP server',
  'droid.toggle_mcp_server': 'Turning an MCP server on or off',
  'droid.authenticate_mcp_server': 'Signing in to an MCP server',
  'droid.submit_bug_report': 'Sending a bug report'
}

/** Keeps Droid's code, so a caller that tells a missing method by it still can. */
export function droidRequestFailure(method: string, error: unknown): unknown {
  const action = ACTIONS[method]
  return action !== undefined && isDroidMethodNotFound(error)
    ? new DroidRpcError(error.code, needsNewerDroidSentence(action), error.data)
    : error
}
