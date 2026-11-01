import { join } from 'node:path'
import { readHooksJson } from '../agent-hooks/installer-utils'

/** Where Factory documents the organization-managed settings file for each OS. */
export function getDroidOrgSettingsPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    return '/Library/Application Support/Factory/settings.json'
  }
  if (platform === 'win32') {
    return join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Factory', 'settings.json')
  }
  return '/etc/factory/settings.json'
}

/**
 * True only when the org file says user and project hooks are ignored. A missing or unreadable file
 * is an empty policy, which is what Factory documents for an invalid one.
 */
export function orgAllowsManagedHooksOnly(orgSettingsPath: string): boolean {
  return readHooksJson(orgSettingsPath)?.allowManagedHooksOnly === true
}
