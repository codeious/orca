import { ipcMain } from 'electron'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type { RuntimeStatus } from '../../../shared/runtime-types'
import { resolveEnvironment } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { isRuntimeEnvironmentManuallyDisconnected } from './runtime-environment-manual-disconnect'
import { manuallyDisconnectedResponse } from './runtime-environment-call-failure'
import { getRuntimeEnvironmentStatus } from './runtime-environment-status-probe'
import { observeWslOrcadHostResponse } from '../../wsl/orcad/wsl-orcad-host-environments'

export function registerPassiveStatusHandler(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:getStatus',
    async (
      _event,
      args: { selector: string; timeoutMs?: number; observeOnly?: true }
    ): Promise<RuntimeRpcResponse<RuntimeStatus>> => {
      const environment = resolveEnvironment(getUserDataPath(), args.selector)
      if (isRuntimeEnvironmentManuallyDisconnected(environment.id)) {
        return manuallyDisconnectedResponse(environment)
      }
      const response = await getRuntimeEnvironmentStatus(
        getUserDataPath(),
        environment.id,
        args.timeoutMs,
        args.observeOnly ? { observeOnly: true } : undefined
      )
      observeWslOrcadHostResponse(environment.id, 'status.get', response)
      return isRuntimeEnvironmentManuallyDisconnected(environment.id)
        ? manuallyDisconnectedResponse(environment)
        : response
    }
  )
}
