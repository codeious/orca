import { isStableCliVersionFrom } from '../agent-cli-version-probe'

/** The oldest release whose stream-jsonrpc surface Orca's chat was built against. */
export const DROID_CHAT_VERSION_FLOOR = '0.238.0'

/** The wire's major; a different one is a different protocol, whatever the CLI release says. */
export const DROID_PROTOCOL_MAJOR = 1

export function isSupportedDroidVersion(version: string): boolean {
  return isStableCliVersionFrom(version, DROID_CHAT_VERSION_FLOOR)
}

export function isSupportedDroidProtocol(protocolVersion: string): boolean {
  return new RegExp(`^${DROID_PROTOCOL_MAJOR}\\.\\d+\\.\\d+`).test(protocolVersion)
}
