import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import type { AgentHookInstallStatus } from '../../shared/agent-hook-types'
import { readHooksJson, writeHooksJson, writeManagedScript } from '../agent-hooks/installer-utils'
import { refreshManagedScriptIfPresent } from '../agent-hooks/managed-hook-script-refresh'
import {
  readHooksJsonRemote,
  writeHooksJsonRemote,
  writeManagedScriptRemote
} from '../agent-hooks/installer-utils-remote'
import { applyDroidInstall, applyDroidRemove, type DroidHookFiles } from './droid-hook-config'
import { resolveDroidHookCoverage } from './droid-hook-status'
import { getDroidOrgSettingsPath, orgAllowsManagedHooksOnly } from './droid-org-policy'
import {
  getDroidManagedCommand,
  getDroidManagedScript,
  getDroidManagedScriptFileName,
  getDroidManagedScriptPath
} from './droid-hook-script'

function getHooksJsonPath(): string {
  return join(homedir(), '.factory', 'hooks.json')
}

function getSettingsJsonPath(): string {
  return join(homedir(), '.factory', 'settings.json')
}

function errorStatus(configPath: string, detail: string): AgentHookInstallStatus {
  return { agent: 'droid', state: 'error', configPath, managedHooksPresent: false, detail }
}

function readDroidHookFiles(): DroidHookFiles | { error: AgentHookInstallStatus } {
  const configPath = getHooksJsonPath()
  const hooksFile = readHooksJson(configPath)
  if (!hooksFile) {
    return { error: errorStatus(configPath, 'Could not parse Factory hooks.json') }
  }
  const settings = readHooksJson(getSettingsJsonPath())
  if (!settings) {
    return { error: errorStatus(configPath, 'Could not parse Factory settings.json') }
  }
  return { hooksFile, settings }
}

async function readRemoteDroidHookFiles(
  sftp: SFTPWrapper,
  hooksPath: string,
  settingsPath: string
): Promise<DroidHookFiles | { error: AgentHookInstallStatus }> {
  const hooksFile = await readHooksJsonRemote(sftp, hooksPath)
  if (!hooksFile) {
    return { error: errorStatus(hooksPath, 'Could not parse remote Factory hooks.json') }
  }
  const settings = await readHooksJsonRemote(sftp, settingsPath)
  if (!settings) {
    return { error: errorStatus(hooksPath, 'Could not parse remote Factory settings.json') }
  }
  return { hooksFile, settings }
}

export class DroidHookService {
  private readonly orgSettingsPath: string

  constructor(options: { orgSettingsPath?: string } = {}) {
    this.orgSettingsPath = options.orgSettingsPath ?? getDroidOrgSettingsPath()
  }

  async refreshManagedScripts(): Promise<void> {
    await refreshManagedScriptIfPresent(getDroidManagedScriptPath(), getDroidManagedScript())
  }

  getStatus(): AgentHookInstallStatus {
    const files = readDroidHookFiles()
    if ('error' in files) {
      return files.error
    }
    const command = getDroidManagedCommand(getDroidManagedScriptPath())
    return {
      agent: 'droid',
      configPath: getHooksJsonPath(),
      ...resolveDroidHookCoverage(files, command, orgAllowsManagedHooksOnly(this.orgSettingsPath))
    }
  }

  install(): AgentHookInstallStatus {
    const configPath = getHooksJsonPath()
    const scriptPath = getDroidManagedScriptPath()
    // Why: an unparseable file must fail before the script is written, with no side effects.
    const preflight = readDroidHookFiles()
    if ('error' in preflight) {
      return preflight.error
    }
    writeManagedScript(scriptPath, getDroidManagedScript())

    // Why: read again right before writing so a /hooks save that landed during the script
    // write is merged into, not overwritten.
    const files = readDroidHookFiles()
    if ('error' in files) {
      return files.error
    }
    const { settingsChanged } = applyDroidInstall(
      files,
      getDroidManagedCommand(scriptPath),
      getDroidManagedScriptFileName()
    )
    // Why: hooks.json first — once it replaces an event, the old settings.json entry is inert,
    // so a failure between the two writes can never leave Orca's hook double-registered.
    writeHooksJson(configPath, files.hooksFile, { preserveMode: true })
    if (settingsChanged) {
      writeHooksJson(getSettingsJsonPath(), files.settings, { preserveMode: true })
    }
    return this.getStatus()
  }

  // Why: the remote host runs Droid, so its hooks and script go there over SFTP (#7253), in POSIX form even from Windows.
  async installRemote(sftp: SFTPWrapper, remoteHome: string): Promise<AgentHookInstallStatus> {
    const home = remoteHome.replace(/\/$/, '')
    const hooksPath = `${home}/.factory/hooks.json`
    const settingsPath = `${home}/.factory/settings.json`
    const scriptPath = `${home}/.orca/agent-hooks/droid-hook.sh`
    try {
      const preflight = await readRemoteDroidHookFiles(sftp, hooksPath, settingsPath)
      if ('error' in preflight) {
        return preflight.error
      }
      // Why: script first, config last — a partial config write must never point Droid at a
      // script that isn't on disk yet.
      await writeManagedScriptRemote(sftp, scriptPath, getDroidManagedScript('posix'))

      const files = await readRemoteDroidHookFiles(sftp, hooksPath, settingsPath)
      if ('error' in files) {
        return files.error
      }
      const { settingsChanged } = applyDroidInstall(
        files,
        getDroidManagedCommand(scriptPath, 'posix'),
        'droid-hook.sh'
      )
      // Why: the local install keeps a `.bak` of each user file it replaces.
      await writeHooksJsonRemote(sftp, hooksPath, files.hooksFile, { backup: true })
      if (settingsChanged) {
        await writeHooksJsonRemote(sftp, settingsPath, files.settings, { backup: true })
      }

      return {
        agent: 'droid',
        state: 'installed',
        configPath: hooksPath,
        managedHooksPresent: true,
        detail: null
      }
    } catch (err) {
      return errorStatus(hooksPath, err instanceof Error ? err.message : String(err))
    }
  }

  remove(): AgentHookInstallStatus {
    const files = readDroidHookFiles()
    if ('error' in files) {
      return files.error
    }
    const { hooksChanged, settingsChanged } = applyDroidRemove(
      files,
      getDroidManagedScriptFileName()
    )
    if (hooksChanged) {
      writeHooksJson(getHooksJsonPath(), files.hooksFile, { preserveMode: true })
    }
    if (settingsChanged) {
      writeHooksJson(getSettingsJsonPath(), files.settings, { preserveMode: true })
    }
    return this.getStatus()
  }
}

export const droidHookService = new DroidHookService()
