/** Optional host-authored words; unknown keys retain the accompanying text fallback. */
export type AgentSessionHostText = {
  textKey?: string
  textParams?: Record<string, string | number>
}

export function readAgentSessionHostText(value: unknown): AgentSessionHostText {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('textKey' in value) ||
    typeof value.textKey !== 'string' ||
    value.textKey.trim().length === 0 ||
    value.textKey.length > 256
  ) {
    return {}
  }
  const textKey = value.textKey
  if (
    !('textParams' in value) ||
    typeof value.textParams !== 'object' ||
    value.textParams === null ||
    Array.isArray(value.textParams)
  ) {
    return { textKey }
  }
  const entries: [string, string | number][] = []
  for (const [key, param] of Object.entries(value.textParams)) {
    if (entries.length === 32) {
      break
    }
    if (key.length === 0 || key.length > 128) {
      continue
    }
    if (
      (typeof param === 'string' && param.length <= 4096) ||
      (typeof param === 'number' && Number.isFinite(param))
    ) {
      entries.push([key, param])
    }
  }
  return { textKey, ...(entries.length ? { textParams: Object.fromEntries(entries) } : {}) }
}
