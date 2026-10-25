export const JSON_RPC_METHOD_NOT_FOUND = -32601
export const JSON_RPC_INVALID_PARAMS = -32602
export const JSON_RPC_INTERNAL_ERROR = -32603
/** Implementation-defined server error; Orca answers with it when too many requests are open. */
export const JSON_RPC_SERVER_BUSY = -32000

/** Droid answered a request with a JSON-RPC error. */
export class DroidRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown
  ) {
    super(message)
    this.name = 'DroidRpcError'
  }
}

export class DroidConnectionClosedError extends Error {
  constructor(message = 'Droid connection closed') {
    super(message)
    this.name = 'DroidConnectionClosedError'
  }
}

export class DroidRequestTimeoutError extends Error {
  constructor(readonly method: string) {
    super(`Droid did not answer ${method} in time`)
    this.name = 'DroidRequestTimeoutError'
  }
}
