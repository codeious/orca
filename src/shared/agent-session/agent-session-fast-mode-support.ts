export type AgentSessionFastModeSupport = {
  supported: boolean
  /** Provider-authored or host-normalized reason code; presentation may ignore unknown values. */
  reason?: string
}
