import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { homedirMock } = vi.hoisted(() => ({ homedirMock: vi.fn<() => string>() }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/orca-user-data' } }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof Os>()),
  homedir: homedirMock
}))

import * as installer from '../agent-hooks/installer-utils'
import { DroidHookService } from './hook-service'
import { getDroidManagedCommand, getDroidManagedScriptPath } from './droid-hook-script'
import { eventEntries, parseJsonObject } from './droid-hooks-file.test-fixture'

const userHook = { hooks: [{ type: 'command', command: 'echo user-hook' }] }

describe('Droid hook-file migration', () => {
  let root: string
  let home: string
  let service: DroidHookService
  let hooksPath: string
  let settingsPath: string
  let orgPath: string

  function write(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  }

  const read = (path: string) => parseJsonObject(readFileSync(path, 'utf8'))

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-droid-hooks-'))
    home = join(root, 'home')
    hooksPath = join(home, '.factory', 'hooks.json')
    settingsPath = join(home, '.factory', 'settings.json')
    orgPath = join(root, 'org.json')
    homedirMock.mockReturnValue(home)
    vi.stubEnv('ORCA_USER_DATA_PATH', join(root, 'user-data'))
    service = new DroidHookService({ orgSettingsPath: orgPath })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  it('migrates only managed entries and retains user hooks and unrelated settings', () => {
    const legacy = { hooks: [{ command: getDroidManagedCommand(getDroidManagedScriptPath()) }] }
    const settings = {
      disabledSkills: ['pdf'],
      enabledPlugins: ['plugin'],
      permissionRules: { allow: ['Read'] },
      hooks: {
        SessionStart: [userHook],
        Stop: [userHook, legacy],
        PermissionRequest: [userHook, legacy]
      }
    }
    write(settingsPath, settings)
    const original = readFileSync(settingsPath, 'utf8')

    expect(service.install()).toMatchObject({
      state: 'installed',
      configPath: hooksPath,
      managedHooksPresent: true
    })
    const hooks = read(hooksPath)
    expect(hooks.hooks).toBeUndefined()
    expect(hooks.PermissionRequest).toBeUndefined()
    expect(eventEntries(hooks, 'Stop')).toHaveLength(2)
    expect(eventEntries(hooks, 'Stop')[0]).toEqual(userHook)
    expect(eventEntries(hooks, 'SessionStart')[0]).toEqual(userHook)
    expect(read(settingsPath)).toEqual({
      ...settings,
      hooks: { SessionStart: [userHook], Stop: [userHook], PermissionRequest: [userHook] }
    })
    expect(readFileSync(`${settingsPath}.bak`, 'utf8')).toBe(original)

    expect(service.remove().managedHooksPresent).toBe(false)
    expect(eventEntries(read(hooksPath), 'Stop')).toEqual([userHook])
    expect(read(settingsPath).disabledSkills).toEqual(['pdf'])
  })

  it('repairs a shadowed event without changing non-event keys or unrelated settings bytes', () => {
    write(settingsPath, { theme: 'dark' })
    const originalSettings = readFileSync(settingsPath, 'utf8')
    service.install()
    write(hooksPath, { ...read(hooksPath), Stop: [userHook], metadata: { custom: true } })
    expect(service.getStatus().state).toBe('partial')
    expect(service.install().state).toBe('installed')
    expect(eventEntries(read(hooksPath), 'Stop')).toHaveLength(2)
    expect(read(hooksPath).metadata).toEqual({ custom: true })
    expect(readFileSync(settingsPath, 'utf8')).toBe(originalSettings)
    expect(existsSync(`${settingsPath}.bak`)).toBe(false)
  })

  it('preserves the last recoverable backup on an unchanged reinstall', () => {
    write(hooksPath, { Stop: [userHook] })
    const original = readFileSync(hooksPath, 'utf8')
    service.install()
    const installed = readFileSync(hooksPath, 'utf8')
    service.install()
    expect(readFileSync(hooksPath, 'utf8')).toBe(installed)
    expect(readFileSync(`${hooksPath}.bak`, 'utf8')).toBe(original)
    service.remove()
    const removed = readFileSync(hooksPath, 'utf8')
    service.remove()
    expect(readFileSync(hooksPath, 'utf8')).toBe(removed)
    expect(readFileSync(`${hooksPath}.bak`, 'utf8')).toBe(installed)
  })

  it.each(['hooks.json', 'settings.json'])(
    'refuses malformed %s before writing a script',
    (file) => {
      const path = join(home, '.factory', file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, '{invalid')
      expect(service.install().state).toBe('error')
      expect(readFileSync(path, 'utf8')).toBe('{invalid')
      expect(existsSync(getDroidManagedScriptPath())).toBe(false)
    }
  )

  it.each(['hooks', 'settings', 'org'] as const)(
    'reports the %s disable policy without clearing it',
    (policy) => {
      if (policy === 'hooks') {
        write(hooksPath, { hooksDisabled: true })
      } else if (policy === 'settings') {
        write(settingsPath, { hooks: { hooksDisabled: true } })
      } else {
        write(orgPath, { allowManagedHooksOnly: true })
      }
      const status = service.install()
      expect(status).toMatchObject({ state: 'partial', managedHooksPresent: true })
      expect(status.detail).toMatch(/disabled|organization/)
      service.remove()
      expect(service.getStatus().state).toBe('partial')
    }
  )

  it('ignores the top-level settings switch that Droid itself ignores', () => {
    write(settingsPath, { hooksDisabled: true })
    expect(service.install().state).toBe('installed')
    expect(read(settingsPath).hooksDisabled).toBe(true)
  })

  it('merges a hooks save made while publishing the script', () => {
    const publish = installer.writeManagedScript
    vi.spyOn(installer, 'writeManagedScript').mockImplementation((...args) => {
      write(hooksPath, { Stop: [userHook], hooksDisabled: true })
      publish(...args)
    })
    expect(service.install().state).toBe('partial')
    expect(eventEntries(read(hooksPath), 'Stop')[0]).toEqual(userHook)
    expect(read(hooksPath).hooksDisabled).toBe(true)
  })
})
