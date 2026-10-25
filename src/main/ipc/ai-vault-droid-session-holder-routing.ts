import { ipcMain } from 'electron'
import {
  AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL,
  type AiVaultDroidSessionHolder,
  type AiVaultDroidSessionHolderArgs,
  type AiVaultDroidSessionHolderResult
} from '../../shared/ai-vault-droid-session-holder'
import { parseRoutableExecutionHostId } from '../../shared/execution-host'
import { AiVaultDroidSessionHolderParams } from '../../shared/rpc-contract/ai-vault-params'

export const AI_VAULT_DROID_SESSION_HOLDER_CHANNEL = 'aiVault:droidSessionHolder'

export type AiVaultDroidSessionHolderReaders = {
  readLocal?: (sessionId: string) => Promise<AiVaultDroidSessionHolder>
  readRuntime?: (environmentId: string, sessionId: string) => Promise<AiVaultDroidSessionHolder>
}

export type AiVaultDroidSessionHolderHandlerOptions = {
  readLocalDroidSessionHolder?: AiVaultDroidSessionHolderReaders['readLocal']
  readRuntimeDroidSessionHolder?: AiVaultDroidSessionHolderReaders['readRuntime']
}

// The host that owns the pane owns the answer: this process never probes a pid on another
// machine, and every route that cannot ask answers cannot-tell, never "free".
export async function resolveAiVaultDroidSessionHolderByHost(
  args: AiVaultDroidSessionHolderArgs,
  readers: AiVaultDroidSessionHolderReaders
): Promise<AiVaultDroidSessionHolder> {
  const host = parseRoutableExecutionHostId(args.executionHostId)
  try {
    if (host?.kind === 'local' && readers.readLocal) {
      return await readers.readLocal(args.sessionId)
    }
    if (host?.kind === 'runtime' && readers.readRuntime) {
      return await readers.readRuntime(host.environmentId, args.sessionId)
    }
  } catch {
    return AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL
  }
  return AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL
}

export function registerAiVaultDroidSessionHolderHandler(
  options: AiVaultDroidSessionHolderHandlerOptions
): void {
  ipcMain.handle(
    AI_VAULT_DROID_SESSION_HOLDER_CHANNEL,
    async (_event, args: unknown): Promise<AiVaultDroidSessionHolderResult> => {
      const request = readRequest(args)
      if (!request) {
        return { holder: AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL }
      }
      return {
        holder: await resolveAiVaultDroidSessionHolderByHost(request, {
          readLocal: options.readLocalDroidSessionHolder,
          readRuntime: options.readRuntimeDroidSessionHolder
        })
      }
    }
  )
}

function readRequest(args: unknown): AiVaultDroidSessionHolderArgs | null {
  if (typeof args !== 'object' || args === null) {
    return null
  }
  const executionHostId: unknown = Reflect.get(args, 'executionHostId')
  const session = AiVaultDroidSessionHolderParams.safeParse(args)
  if (typeof executionHostId !== 'string' || !session.success) {
    return null
  }
  return { executionHostId, sessionId: session.data.sessionId }
}
