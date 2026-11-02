import { markEnvironmentUsed } from '../../../shared/runtime-environment-store'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'

export function markEnvironmentUsedFromResponse(
  userDataPath: string,
  environmentId: string,
  response: RuntimeRpcResponse<unknown>
): void {
  if (response.ok === true) {
    markEnvironmentUsed(userDataPath, environmentId, { runtimeId: response._meta.runtimeId })
  }
}

/** Subscription callbacks cannot reject to a caller; usage writes must tolerate removed or unreadable environments. */
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
