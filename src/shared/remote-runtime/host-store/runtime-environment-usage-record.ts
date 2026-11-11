import type { RuntimeRpcResponse } from '../../runtime-rpc-envelope'
import { markEnvironmentUsed } from './runtime-environment-store'

/** Last-used bookkeeping must never fail a reply that already arrived: read-only stores and removed environments skip it. */
export function recordRuntimeEnvironmentUsage(
  userDataPath: string,
  selector: string,
  args: Parameters<typeof markEnvironmentUsed>[2] = {}
): void {
  try {
    markEnvironmentUsed(userDataPath, selector, args)
  } catch (error) {
    console.warn(
      `Skipped last-used bookkeeping for runtime environment ${selector}:`,
      error instanceof Error ? error.message : error
    )
  }
}

export function markEnvironmentUsedFromResponse(
  userDataPath: string,
  environmentId: string,
  response: RuntimeRpcResponse<unknown>
): void {
  if (response.ok === true) {
    recordRuntimeEnvironmentUsage(userDataPath, environmentId, {
      runtimeId: response._meta.runtimeId
    })
  }
}
