import { isStableCliVersionFrom } from '../agent-cli-version-probe'
import { isPrereleaseAppVersion, isValidAppVersion } from '../../shared/app-version'
import type { UnsupportedAgentVersion } from '../native-chat/structured-agent-session-create-support'

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

/** The release when it is stable and older than the floor, which is the one case an update fixes;
 *  a prerelease or a version Orca can't read is refused without saying it is "older". */
export function unsupportedDroidRelease(version: string): UnsupportedAgentVersion | null {
  if (
    !isValidAppVersion(version) ||
    isPrereleaseAppVersion(version) ||
    isSupportedDroidVersion(version)
  ) {
    return null
  }
  return {
    agentName: 'Droid',
    found: version,
    floor: DROID_CHAT_VERSION_FLOOR,
    updateCommand: 'droid update'
  }
}
