import {
  compareAppVersions,
  isPrereleaseAppVersion,
  isValidAppVersion
} from '../../shared/app-version'
import { DROID_CHAT_VERSION_FLOOR } from '../../shared/droid-chat-version-floor'
import type { AgentCliInstallationProblem } from '../../shared/agent-cli-installation-problem'

// Lives in shared so the settings words name the same release the launch check uses.
export { DROID_CHAT_VERSION_FLOOR }

/** The wire's major; a different one is a different protocol, whatever the CLI release says. */
export const DROID_PROTOCOL_MAJOR = 1

export function isSupportedDroidVersion(version: string): boolean {
  return (
    typeof version === 'string' &&
    isValidAppVersion(version) &&
    !isPrereleaseAppVersion(version) &&
    compareAppVersions(version, DROID_CHAT_VERSION_FLOOR) >= 0
  )
}

export function isSupportedDroidProtocol(protocolVersion: string): boolean {
  return new RegExp(`^${DROID_PROTOCOL_MAJOR}\\.\\d+\\.\\d+$`).test(protocolVersion)
}

/** The release when it is stable and older than the floor, which is the one case an update fixes;
 *  a prerelease or a version Orca can't read is refused without saying it is "older". */
export function unsupportedDroidRelease(version: string): AgentCliInstallationProblem | null {
  if (
    typeof version !== 'string' ||
    !isValidAppVersion(version) ||
    isPrereleaseAppVersion(version) ||
    isSupportedDroidVersion(version)
  ) {
    return null
  }
  return {
    agent: 'droid',
    installedVersion: version,
    minimumVersion: DROID_CHAT_VERSION_FLOOR
  }
}
