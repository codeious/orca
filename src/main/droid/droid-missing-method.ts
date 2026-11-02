import { JSON_RPC_METHOD_NOT_FOUND } from '../acp/acp-errors'
import { DroidRpcError } from './droid-rpc-errors'

export function isDroidMethodNotFound(error: unknown): boolean {
  return error instanceof DroidRpcError && error.code === JSON_RPC_METHOD_NOT_FOUND
}
