import {
  AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL,
  parseAiVaultDroidSessionHolder,
  type AiVaultDroidSessionHolder
} from '../../shared/ai-vault-droid-session-holder'
import { callRuntimeEnvironment } from '../ipc/runtime-environment-transport-routing'

// Any reply short of an explicit holder (an older host's method_not_found, a dropped
// connection) is "cannot tell": only the owning host's own null may free a session.
export async function readRuntimeAiVaultDroidSessionHolder(
  userDataPath: string,
  environmentId: string,
  sessionId: string
): Promise<AiVaultDroidSessionHolder> {
  try {
    const response = await callRuntimeEnvironment(
      userDataPath,
      environmentId,
      'aiVault.droidSessionHolder',
      { sessionId }
    )
    return response.ok === true
      ? parseAiVaultDroidSessionHolder(response.result)
      : AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL
  } catch {
    return AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL
  }
}
