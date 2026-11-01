import { ipcMain } from 'electron'
import {
  addEnvironmentFromPairingCode,
  listEnvironments,
  removeEnvironment,
  resolveEnvironment
} from '../../shared/runtime-environment-store'
import {
  redactRuntimeEnvironment,
  type PublicKnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import { RuntimeRpcCallQueueOverloadError } from '../../shared/runtime-rpc-call-queue'
import type { RuntimeRpcFailure, RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import type { RuntimeStatus } from '../../shared/runtime-types'
import type { Store } from '../persistence'
import { retireRemovedRuntimeEnvironment } from './runtime-environment-removal-cleanup'
import { readSettingsWithRuntimeEnvironmentPreference } from './runtime-environment-preference'
import { verifyAndAddRuntimeEnvironmentFromPairingCode } from './runtime-environment-pairing-verification'
import {
  closeRemoteRuntimeRequestConnection,
  getRuntimeEnvironmentStatusOwner,
  getRuntimeEnvironmentStatusSnapshots,
  retryRemoteRuntimeSharedControlConnectionNow
} from './runtime-environment-request-connections'
import {
  clearRuntimeEnvironmentManualDisconnect,
  isRuntimeEnvironmentManuallyDisconnected,
  markRuntimeEnvironmentManuallyDisconnected,
  RUNTIME_MANUALLY_DISCONNECTED_MESSAGE
} from './runtime-environment-manual-disconnect'
import {
  callRuntimeEnvironment,
  getRuntimeEnvironmentStatus
} from './runtime-environment-transport-routing'
import { publicRuntimeEnvironmentWithHostKey } from './runtime-environment-host-key'
import type { RetainedRemoteRuntimeSubscription } from './runtime-environment-subscription-handlers'
import { runtimeEnvironmentRevisionFailure } from './runtime-environment-revision-guard'

function manuallyDisconnectedResponse(
  environment: ReturnType<typeof resolveEnvironment>
): RuntimeRpcResponse<never> {
  return {
    id: 'runtime.manualDisconnect',
    ok: false,
    error: {
      code: 'runtime_manually_disconnected',
      message: RUNTIME_MANUALLY_DISCONNECTED_MESSAGE
    },
    _meta: { runtimeId: environment.runtimeId }
  }
}

export { isRuntimeEnvironmentManuallyDisconnected }

type ConnectivityHandlerOptions = {
  store: Store
  getUserDataPath: () => string
  invalidateTransport: (environmentId: string) => Promise<void> | void
}

export function registerRuntimeEnvironmentConnectivityHandlers({
  store,
  getUserDataPath,
  invalidateTransport
}: ConnectivityHandlerOptions): void {
  ipcMain.handle('runtimeEnvironments:getStatusSnapshots', () =>
    getRuntimeEnvironmentStatusSnapshots()
  )
  ipcMain.handle('runtimeEnvironments:list', () => {
    const environments = listEnvironments(getUserDataPath())
    readSettingsWithRuntimeEnvironmentPreference(store, getUserDataPath())
    return environments.map(publicRuntimeEnvironmentWithHostKey)
  })
  ipcMain.handle(
    'runtimeEnvironments:addFromPairingCode',
    (
      _event,
      args: { name: string; pairingCode: string }
    ): { environment: PublicKnownRuntimeEnvironment } => {
      const environment = addEnvironmentFromPairingCode(getUserDataPath(), args)
      clearRuntimeEnvironmentManualDisconnect(environment.id)
      return { environment: redactRuntimeEnvironment(environment) }
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:verifyAndAddFromPairingCode',
    async (_event, args: { name: string; pairingCode: string; allowLoopback?: boolean }) => {
      const result = await verifyAndAddRuntimeEnvironmentFromPairingCode(getUserDataPath(), args)
      if (result.ok) {
        clearRuntimeEnvironmentManualDisconnect(result.environment.id)
        getRuntimeEnvironmentStatusOwner(getUserDataPath(), result.environment.id).acceptVerified({
          id: 'status.get',
          ok: true,
          result: result.runtimeStatus,
          _meta: { runtimeId: result.runtimeStatus.runtimeId }
        })
      }
      return result
    }
  )
  ipcMain.handle('runtimeEnvironments:resolve', (_event, args: { selector: string }) =>
    redactRuntimeEnvironment(resolveEnvironment(getUserDataPath(), args.selector))
  )
  ipcMain.handle(
    'runtimeEnvironments:remove',
    (_event, args: { selector: string }): { removed: PublicKnownRuntimeEnvironment } => {
      const environment = resolveEnvironment(getUserDataPath(), args.selector)
      if (store.getSettings().activeRuntimeEnvironmentId === environment.id) {
        throw new Error(
          'This server is the default host for new projects. Choose another one in Advanced before removing it.'
        )
      }
      const removed = removeEnvironment(getUserDataPath(), args.selector)
      void retireRemovedRuntimeEnvironment(removed.id, invalidateTransport, store)
      closeLegacySelectorTransport(args.selector, removed.id)
      return { removed: redactRuntimeEnvironment(removed) }
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:disconnect',
    (_event, args: { selector: string }): { disconnected: PublicKnownRuntimeEnvironment } => {
      const environment = resolveEnvironment(getUserDataPath(), args.selector)
      markRuntimeEnvironmentManuallyDisconnected(environment.id)
      invalidateTransport(environment.id)
      closeLegacySelectorTransport(args.selector, environment.id)
      // Retain disconnected evidence for renderers that missed the teardown event.
      getRuntimeEnvironmentStatusOwner(getUserDataPath(), environment.id)
      return { disconnected: redactRuntimeEnvironment(environment) }
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:connect',
    async (
      _event,
      args: { selector: string; timeoutMs?: number }
    ): Promise<RuntimeRpcResponse<RuntimeStatus>> => {
      const environment = resolveEnvironment(getUserDataPath(), args.selector)
      clearRuntimeEnvironmentManualDisconnect(environment.id)
      return getRuntimeEnvironmentStatus(getUserDataPath(), environment.id, args.timeoutMs, {
        reconnect: true
      })
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:retryControlConnection',
    (_event, args: { selector: string }): void => {
      const environment = resolveEnvironment(getUserDataPath(), args.selector)
      if (!isRuntimeEnvironmentManuallyDisconnected(environment.id)) {
        retryRemoteRuntimeSharedControlConnectionNow(environment.id)
      }
    }
  )
}

export function registerRuntimeEnvironmentPassiveHandlers(
  getUserDataPath: () => string,
  subscriptions: ReadonlyMap<string, RetainedRemoteRuntimeSubscription>
): void {
  registerPassiveStatusHandler(getUserDataPath)
  registerPassiveCallHandler(getUserDataPath, subscriptions)
}

function closeLegacySelectorTransport(selector: string, environmentId: string): void {
  if (selector === environmentId) {
    return
  }
  closeRemoteRuntimeRequestConnection(selector)
}

function registerPassiveStatusHandler(getUserDataPath: () => string): void {
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
      return isRuntimeEnvironmentManuallyDisconnected(environment.id)
        ? manuallyDisconnectedResponse(environment)
        : response
    }
  )
}

function runtimeEnvironmentCallFailure(
  environment: ReturnType<typeof resolveEnvironment>,
  method: string,
  error: unknown
): RuntimeRpcFailure | null {
  if (
    !(error instanceof RemoteRuntimeClientError) &&
    !(error instanceof RuntimeRpcCallQueueOverloadError)
  ) {
    return null
  }
  return {
    id: method,
    ok: false,
    error: { code: error.code, message: error.message },
    _meta: { runtimeId: environment.runtimeId }
  }
}

function registerPassiveCallHandler(
  getUserDataPath: () => string,
  subscriptions: ReadonlyMap<string, RetainedRemoteRuntimeSubscription>
): void {
  ipcMain.handle(
    'runtimeEnvironments:call',
    async (
      event,
      args: {
        selector: string
        method: string
        params?: unknown
        timeoutMs?: number
        expectedEnvironmentPairingRevision?: number
        expectedEnvironmentRuntimeId?: string
      }
    ): Promise<RuntimeRpcResponse<unknown>> => {
      const environment = resolveEnvironment(getUserDataPath(), args.selector)
      if (isRuntimeEnvironmentManuallyDisconnected(environment.id)) {
        return manuallyDisconnectedResponse(environment)
      }
      let response: RuntimeRpcResponse<unknown>
      try {
        const sessionId = mcpSignInSessionId(args.method, args.params)
        const transcript =
          sessionId === undefined
            ? undefined
            : [...subscriptions.values()].find(
                (subscription) =>
                  subscription.environmentId === environment.id &&
                  subscription.ownerWebContentsId === event.sender.id &&
                  subscription.sessionId === sessionId &&
                  subscription.sendRequest
              )
        // The host binds browser forwarding to the transcript's authenticated socket.
        if (transcript?.sendRequest) {
          const failure = runtimeEnvironmentRevisionFailure(
            environment,
            args.expectedEnvironmentPairingRevision,
            args.method,
            args.expectedEnvironmentRuntimeId
          )
          if (failure) {
            return failure
          }
          response = await transcript.sendRequest(
            args.method,
            args.params,
            args.timeoutMs ?? 15_000
          )
        } else {
          response = await callRuntimeEnvironment(
            getUserDataPath(),
            environment.id,
            args.method,
            args.params,
            args.timeoutMs,
            args.expectedEnvironmentPairingRevision,
            undefined,
            { expectedEnvironmentRuntimeId: args.expectedEnvironmentRuntimeId }
          )
        }
      } catch (error) {
        const failure = runtimeEnvironmentCallFailure(environment, args.method, error)
        if (failure) {
          return failure
        }
        throw error
      }
      return isRuntimeEnvironmentManuallyDisconnected(environment.id)
        ? manuallyDisconnectedResponse(environment)
        : response
    }
  )
}

function mcpSignInSessionId(method: string, params: unknown): string | undefined {
  if (
    method !== 'agentSession.droidCommand' ||
    typeof params !== 'object' ||
    params === null ||
    !('sessionId' in params) ||
    typeof params.sessionId !== 'string' ||
    !('command' in params) ||
    typeof params.command !== 'object' ||
    params.command === null ||
    !('name' in params.command) ||
    params.command.name !== 'mcp' ||
    !('action' in params.command) ||
    typeof params.command.action !== 'object' ||
    params.command.action === null ||
    !('kind' in params.command.action) ||
    params.command.action.kind !== 'sign-in'
  ) {
    return undefined
  }
  return params.sessionId
}
