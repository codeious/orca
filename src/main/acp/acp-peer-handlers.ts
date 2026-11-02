export type AcpRequestContext = { id: string | number | null; signal: AbortSignal }

export type AcpPeerHandlers = {
  // Void is handled; unsupported methods throw -32601. Aborted handlers still reply or throw -32800.
  onRequest?: (method: string, params: unknown, context: AcpRequestContext) => unknown
  onNotification?: (method: string, params: unknown) => void
  onDiagnostic?: (message: string) => void
  onClose?: (error: Error) => void
  /** Includes non-protocol output and unterminated final lines. */
  onOtherLine?: (line: string, cut?: boolean) => void
}
