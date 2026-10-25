import { isStableCliVersionFrom } from '../agent-cli-version-probe'
import { isPrereleaseAppVersion, isValidAppVersion } from '../../shared/app-version'
import { DROID_CHAT_VERSION_FLOOR } from '../../shared/droid-chat-version-floor'
import type { UnsupportedAgentVersion } from '../native-chat/structured-agent-session-create-support'

// Lives in shared so the settings words name the same release the launch check uses.
export { DROID_CHAT_VERSION_FLOOR }

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
