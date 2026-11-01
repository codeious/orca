import type { DroidHostCopyKey } from '../../shared/droid-host-copy'
import { droidHostText } from './droid-host-text'
import { DroidRpcError } from './droid-rpc-errors'

const METHOD_NOT_FOUND = -32601

/** Only the code is read: an older Droid words the message differently. */
export function isDroidMethodNotFound(error: unknown): error is DroidRpcError {
  return error instanceof DroidRpcError && error.code === METHOD_NOT_FOUND
}

/** A method left out keeps Droid's own error: `droid.close_session` is one, as before. */
const ACTIONS: Readonly<Record<string, DroidHostCopyKey>> = {
  'droid.compact_session': 'newerCompact',
  'droid.fork_session': 'newerFork',
  'droid.get_rewind_info': 'newerRewind',
  'droid.execute_rewind': 'newerRewind',
  'droid.rename_session': 'newerRename',
  'droid.get_context_stats': 'newerContext',
  'droid.get_context_breakdown': 'newerContext',
  'droid.change_working_directory': 'newerCwd',
  'droid.list_skills': 'newerSkills',
  'droid.set_skill_disabled': 'newerSkillToggle',
  'droid.list_mcp_servers': 'newerMcp',
  'droid.add_mcp_server': 'newerMcpAdd',
  'droid.remove_mcp_server': 'newerMcpRemove',
  'droid.toggle_mcp_server': 'newerMcpToggle',
  'droid.authenticate_mcp_server': 'newerMcpSignIn',
  'droid.submit_bug_report': 'newerBug'
}

/** Keeps Droid's code, so a caller that tells a missing method by it still can. */
export function droidRequestFailure(method: string, error: unknown): unknown {
  const key = ACTIONS[method]
  if (key === undefined || !isDroidMethodNotFound(error)) {
    return error
  }
  const words = droidHostText(key)
  return Object.assign(new DroidRpcError(error.code, words.text, error.data), words)
}
