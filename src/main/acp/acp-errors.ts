import type { AuthMethod } from './generated/acp-protocol.generated'
import { withProviderRequestTimeout } from '../provider-process/provider-request-timeout'

export const JSON_RPC_INVALID_REQUEST = -32600
export const JSON_RPC_METHOD_NOT_FOUND = -32601
export const JSON_RPC_INVALID_PARAMS = -32602
export const JSON_RPC_INTERNAL_ERROR = -32603
/** The code ACP agents answer with when the user has not signed in. */
export const ACP_AUTH_REQUIRED = -32000
export const ACP_RESOURCE_NOT_FOUND = -32002
export const ACP_REQUEST_CANCELLED = -32800

export class AcpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown
  ) {
    super(message)
    this.name = 'AcpRpcError'
  }
}

/** A rejection received from the agent, distinct from local transport failures. */
export class AcpAgentError extends AcpRpcError {
  constructor(code: number, message: string, data?: unknown) {
    super(code, message, data)
    this.name = 'AcpAgentError'
  }
}

export class AcpAuthRequiredError extends AcpAgentError {
  constructor(
    message: string,
    data?: unknown,
    readonly authMethods: AuthMethod[] = []
  ) {
    super(ACP_AUTH_REQUIRED, message, data)
    this.name = 'AcpAuthRequiredError'
  }
}

/** Orca's sign-in prompt message, distinct from an agent-authored error. */
export class AcpSignInPromptError extends AcpAuthRequiredError {}

/** Preserve prompt errors so Orca's diagnostic text is never attributed to the agent. */
export function acpAuthRequiredError(
  error: AcpAgentError,
  authMethods?: AuthMethod[]
): AcpAuthRequiredError {
  return error instanceof AcpSignInPromptError
    ? error
    : new AcpAuthRequiredError(error.message, error.data, authMethods)
}

/** Retains the raw answer in `data` and validation failures in `issues`. */
export class AcpInvalidResponseError extends AcpRpcError {
  constructor(
    message: string,
    raw: unknown,
    readonly issues?: unknown
  ) {
    super(JSON_RPC_INTERNAL_ERROR, message, raw)
    this.name = 'AcpInvalidResponseError'
  }
}

export class AcpFrameTooLargeError extends Error {
  constructor(
    readonly method: string | null,
    readonly observedBytes: number,
    readonly maxBytes: number
  ) {
    super(
      `ACP${method ? ` ${method}` : ''} message exceeds ${maxBytes} byte limit (${observedBytes} bytes received)`
    )
    this.name = 'AcpFrameTooLargeError'
  }
}

export class AcpConnectionClosedError extends Error {
  constructor(message = 'ACP connection closed') {
    super(message)
    this.name = 'AcpConnectionClosedError'
  }
}

export class AcpRequestTimeoutError extends Error {
  constructor(
    readonly method: string,
    timeoutMs: number
  ) {
    super(`ACP request timed out: ${method}`)
    this.name = 'AcpRequestTimeoutError'
    withProviderRequestTimeout(this, { method, timeoutMs })
  }
}
