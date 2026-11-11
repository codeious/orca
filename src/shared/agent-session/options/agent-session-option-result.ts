export type AgentSessionOptionResult = {
  key: string
  value: string
  /** Full effective next-turn values when the provider reconciled related options. */
  options?: Record<string, string>
}
