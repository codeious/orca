/** An installed release older than the oldest structured chat supports. */
export type UnsupportedAgentVersion = {
  /** How a sentence names the agent, e.g. "Droid". */
  agentName: string
  found: string
  floor: string
  /** What the person runs on the computer to update it. */
  updateCommand: string
}

/** The sentence a launch receipt and a desktop toast both show. Not wrapped. */
export function unsupportedAgentVersionDetail(version: UnsupportedAgentVersion): string {
  return `${version.agentName} ${version.found} is older than ${version.floor}, the oldest release Orca's chat supports. Run \`${version.updateCommand}\` on this computer.`
}

function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || !(key in value)) {
    return undefined
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: `key in value` proves this object has the field.
  return (value as Record<string, unknown>)[key]
}

function trimmedString(value: unknown, key: string): string {
  const found = field(value, key)
  return typeof found === 'string' ? found.trim() : ''
}

/** A create-support payload's version, or null when a peer omitted or malformed it. */
export function readUnsupportedAgentVersion(value: unknown): UnsupportedAgentVersion | null {
  const agentName = trimmedString(value, 'agentName')
  const found = trimmedString(value, 'found')
  const floor = trimmedString(value, 'floor')
  const updateCommand = trimmedString(value, 'updateCommand')
  if (!agentName || !found || !floor || !updateCommand) {
    return null
  }
  return { agentName, found, floor, updateCommand }
}

/** Receipt detail when this launch opened a terminal because the release is too old. */
export function unsupportedAgentVersionReceiptDetail(result: unknown): string | null {
  const receipt = field(result, 'receipt')
  if (trimmedString(receipt, 'reason') !== 'agent_version_unsupported') {
    return null
  }
  return trimmedString(receipt, 'detail') || null
}
