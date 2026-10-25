import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL_RESULT,
  AI_VAULT_DROID_SESSION_HOLDER_CHANNEL,
  type AiVaultDroidSessionHolderArgs,
  type AiVaultDroidSessionHolderResult
} from '../../shared/ai-vault-droid-session-holder'
import { parseRoutableExecutionHostId } from '../../shared/execution-host'
import { AiVaultDroidSessionHolderParams } from '../../shared/rpc-contract/ai-vault-params'

export type AiVaultDroidSessionHolderReaders = {
  readLocal?: (sessionId: string) => Promise<AiVaultDroidSessionHolderResult>
  readRuntime?: (
    environmentId: string,
    sessionId: string
  ) => Promise<AiVaultDroidSessionHolderResult>
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
): Promise<AiVaultDroidSessionHolderResult> {
  const host = parseRoutableExecutionHostId(args.executionHostId)
  try {
    if (host?.kind === 'local' && readers.readLocal) {
      return await readers.readLocal(args.sessionId)
    }
    if (host?.kind === 'runtime' && readers.readRuntime) {
      return await readers.readRuntime(host.environmentId, args.sessionId)
    }
  } catch {
    return AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL_RESULT
  }
  return AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL_RESULT
}

export function registerAiVaultDroidSessionHolderHandler(
  options: AiVaultDroidSessionHolderHandlerOptions
): void {
  ipcMain.handle(
    AI_VAULT_DROID_SESSION_HOLDER_CHANNEL,
    async (_event, args: unknown): Promise<AiVaultDroidSessionHolderResult> => {
      const request = readRequest(args)
      if (!request) {
        return AI_VAULT_DROID_SESSION_HOLDER_CANNOT_TELL_RESULT
      }
      return resolveAiVaultDroidSessionHolderByHost(request, {
        readLocal: options.readLocalDroidSessionHolder,
        readRuntime: options.readRuntimeDroidSessionHolder
      })
    }
  )
}

const HolderRequest = AiVaultDroidSessionHolderParams.extend({ executionHostId: z.string() })

function readRequest(args: unknown): AiVaultDroidSessionHolderArgs | null {
  const request = HolderRequest.safeParse(args)
  return request.success
    ? { executionHostId: request.data.executionHostId, sessionId: request.data.sessionId }
    : null
}
