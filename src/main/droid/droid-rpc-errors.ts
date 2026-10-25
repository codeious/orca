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
