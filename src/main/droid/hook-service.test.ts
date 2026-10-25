import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as InstallerUtils from '../agent-hooks/installer-utils'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const { getPathMock, homedirMock, whileScriptIsWritten } = vi.hoisted(() => {
  // Stands in for a /hooks save that lands while an install is in flight.
  const whileScriptIsWritten: { run: (() => void) | null } = { run: null }
  return {
    getPathMock: vi.fn<(name: string) => string>(),
    homedirMock: vi.fn<() => string>(),
    whileScriptIsWritten
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock
  }
}))

vi.mock('../agent-hooks/installer-utils', async () => {
  const actual = await vi.importActual<typeof InstallerUtils>('../agent-hooks/installer-utils')
  return {
    ...actual,
    writeManagedScript: (scriptPath: string, content: string): void => {
      whileScriptIsWritten.run?.()
      actual.writeManagedScript(scriptPath, content)
    }
  }
})

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as Record<string, unknown>
  return {
    ...actual,
    homedir: homedirMock
  }
})

import { eventEntries, parseJsonObject } from './droid-hooks-file.test-fixture'
import { DroidHookService } from './hook-service'

const WINDOWS_POWERSHELL_LAUNCHER =
  /^[A-Za-z]:\/[^"]*\/System32\/WindowsPowerShell\/v1\.0\/powershell\.exe -NoProfile -EncodedCommand \S+$/

describe('DroidHookService', () => {
  let homeDir: string
  let userDataDir: string

  const hooksJsonPath = (): string => join(homeDir, '.factory', 'hooks.json')
  const settingsJsonPath = (): string => join(homeDir, '.factory', 'settings.json')
  const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
  const readHooks = (): Record<string, unknown> =>
    parseJsonObject(readFileSync(hooksJsonPath(), 'utf8'))
  const writeJson = (path: string, value: unknown): void => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  }

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'orca-droid-home-'))
    userDataDir = mkdtempSync(join(tmpdir(), 'orca-droid-user-data-'))
    homedirMock.mockReturnValue(homeDir)
    getPathMock.mockImplementation((name: string) => {
      if (name === 'userData') {
        return userDataDir
      }
      throw new Error(`unexpected getPath(${name})`)
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    whileScriptIsWritten.run = null
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('installs the managed command for Droid status events into hooks.json', () => {
    const status = new DroidHookService().install()

    expect(status.state).toBe('installed')
    expect(status.managedHooksPresent).toBe(true)
    expect(status.configPath).toBe(hooksJsonPath())

    // A /hooks save writes event names at the top level, with no `hooks` wrapper.
    const hooks = readHooks()
    expect(Object.keys(hooks).sort()).toEqual(
      [
        'Notification',
        'PostToolUse',
        'PreToolUse',
        'SessionEnd',
        'SessionStart',
        'Stop',
        'SubagentStop',
        'UserPromptSubmit'
      ].sort()
    )
    const preToolUse = eventEntries(hooks, 'PreToolUse')
    const command = preToolUse[0].hooks[0].command
    expect(preToolUse[0].matcher).toBe('*')
    expect(eventEntries(hooks, 'PostToolUse')[0].matcher).toBe('*')
    expect(eventEntries(hooks, 'UserPromptSubmit')[0].matcher).toBeUndefined()
    expect(command).toMatch(
      process.platform === 'win32' ? WINDOWS_POWERSHELL_LAUNCHER : /droid-hook/
    )
    if (process.platform !== 'win32') {
      expect(command).toContain(join(homeDir, '.orca'))
    }
    expect(command).not.toContain(userDataDir)
    expect(existsSync(settingsJsonPath())).toBe(false)
  })

  it('carries settings.json hook entries into hooks.json so Orca does not shadow them', () => {
    const userStop = { hooks: [{ type: 'command', command: 'notify-send done' }] }
    const userPreCompact = { hooks: [{ type: 'command', command: 'save-context' }] }
    const userPreToolUse = { matcher: 'Bash', hooks: [{ type: 'command', command: 'audit' }] }
    writeJson(settingsJsonPath(), {
      hooks: {
        Stop: [userStop],
        PreCompact: [userPreCompact],
        PreToolUse: [
          { matcher: 'Edit', hooks: [{ type: 'command', command: 'ignored-by-droid' }] }
        ],
        // Droid's event enum has no PermissionRequest, and a /hooks save omits it.
        PermissionRequest: [{ hooks: [{ type: 'command', command: 'dead-entry' }] }],
        hooksDisabled: false
      }
    })
    // hooks.json already replaces PreToolUse, so the settings.json PreToolUse never ran.
    writeJson(hooksJsonPath(), { PreToolUse: [userPreToolUse] })

    expect(new DroidHookService().install().state).toBe('installed')

    const hooks = readHooks()
    const stop = eventEntries(hooks, 'Stop')
    const preToolUse = eventEntries(hooks, 'PreToolUse')
    expect(stop).toHaveLength(2)
    expect(stop[0]).toEqual(userStop)
    expect(stop[1].hooks[0].command).toMatch(/droid-hook/)
    expect(hooks.PreCompact).toEqual([userPreCompact])
    expect(preToolUse).toHaveLength(2)
    expect(preToolUse[0]).toEqual(userPreToolUse)
    expect(hooks.PermissionRequest).toBeUndefined()
    expect(hooks).not.toHaveProperty('hooksDisabled')
  })

  describe('writing hooks.json', () => {
    it('leaves hooksDisabled and every other non-event key in place', () => {
      const userStop = { hooks: [{ type: 'command', command: 'notify-send done' }] }
      writeJson(hooksJsonPath(), {
        hooksDisabled: true,
        Stop: [userStop],
        somethingElse: { nested: [1, 2] }
      })

      new DroidHookService().install()

      const hooks = readHooks()
      expect(Object.keys(hooks).slice(0, 3)).toEqual(['hooksDisabled', 'Stop', 'somethingElse'])
      expect(hooks.hooksDisabled).toBe(true)
      expect(hooks.somethingElse).toEqual({ nested: [1, 2] })
      expect(eventEntries(hooks, 'Stop')[0]).toEqual(userStop)
    })

    it('backs up the previous file and does not rewrite when nothing changed', () => {
      const previous = `${JSON.stringify({ Stop: [{ hooks: [{ type: 'command', command: 'a' }] }] }, null, 2)}\n`
      mkdirSync(dirname(hooksJsonPath()), { recursive: true })
      writeFileSync(hooksJsonPath(), previous)

      const service = new DroidHookService()
      service.install()
      expect(readFileSync(`${hooksJsonPath()}.bak`, 'utf8')).toBe(previous)

      const installed = readFileSync(hooksJsonPath(), 'utf8')
      writeFileSync(`${hooksJsonPath()}.bak`, 'sentinel')
      service.install()
      expect(readFileSync(hooksJsonPath(), 'utf8')).toBe(installed)
      expect(readFileSync(`${hooksJsonPath()}.bak`, 'utf8')).toBe('sentinel')
    })

    it('keeps a hooks.json change that lands while the hook script is being written', () => {
      const savedByHooksUi = { hooks: [{ type: 'command', command: 'saved-meanwhile' }] }
      whileScriptIsWritten.run = () => writeJson(hooksJsonPath(), { PreCompact: [savedByHooksUi] })

      expect(new DroidHookService().install().state).toBe('installed')

      const hooks = readHooks()
      expect(hooks.PreCompact).toEqual([savedByHooksUi])
      expect(eventEntries(hooks, 'Stop')).toHaveLength(1)
    })
  })

  describe.each([
    ['hooks.json', hooksJsonPath],
    ['settings.json', settingsJsonPath]
  ])('an unparseable %s', (_name, pathOf) => {
    it('is reported as an error, left untouched, and the hook script is not written', () => {
      mkdirSync(dirname(pathOf()), { recursive: true })
      writeFileSync(pathOf(), '{ not json')

      const status = new DroidHookService().install()

      expect(status.state).toBe('error')
      expect(status.detail).toContain(`Could not parse Factory ${_name}`)
      expect(readFileSync(pathOf(), 'utf8')).toBe('{ not json')
      expect(existsSync(join(homeDir, '.orca', 'agent-hooks'))).toBe(false)
    })
  })

  describe('migrating Orca out of settings.json', () => {
    const oldOrcaEntry = (): { matcher: string; hooks: { type: string; command: string }[] } => ({
      matcher: '*',
      hooks: [
        { type: 'command', command: `'${join(homeDir, '.orca', 'agent-hooks', 'droid-hook.sh')}'` }
      ]
    })

    it('removes only Orca entries and keeps every other settings.json key', () => {
      const userStop = { hooks: [{ type: 'command', command: 'notify-send done' }] }
      const otherKeys = {
        disabledSkills: ['pdf'],
        enabledPlugins: { 'a@b': true },
        permissionRules: { version: 1, rules: [] }
      }
      writeJson(settingsJsonPath(), {
        ...otherKeys,
        hooks: {
          SessionStart: [oldOrcaEntry()],
          Stop: [userStop, oldOrcaEntry()],
          PermissionRequest: [oldOrcaEntry()],
          hooksDisabled: false
        }
      })

      expect(new DroidHookService().install().state).toBe('installed')

      expect(readJson(settingsJsonPath())).toEqual({
        ...otherKeys,
        hooks: { Stop: [userStop], hooksDisabled: false }
      })
      const hooks = readHooks()
      expect(eventEntries(hooks, 'Stop')[0]).toEqual(userStop)
      expect(hooks.PermissionRequest).toBeUndefined()
    })

    it('keeps the hooks key when Orca entries were the only ones in it', () => {
      writeJson(settingsJsonPath(), { disabledSkills: ['pdf'], hooks: { Stop: [oldOrcaEntry()] } })

      new DroidHookService().install()

      expect(readJson(settingsJsonPath())).toEqual({ disabledSkills: ['pdf'], hooks: {} })
    })

    it('leaves settings.json byte-for-byte alone when it holds no Orca entries', () => {
      const original = '{\n    "disabledSkills": ["pdf"],\n    "hooks": { "Stop": [] }\n}\n'
      mkdirSync(dirname(settingsJsonPath()), { recursive: true })
      writeFileSync(settingsJsonPath(), original)

      new DroidHookService().install()

      expect(readFileSync(settingsJsonPath(), 'utf8')).toBe(original)
      expect(existsSync(`${settingsJsonPath()}.bak`)).toBe(false)
    })
  })

  // Why: #6078 — a Windows user profile path with a space used to be written
  // verbatim as the hook command, so the agent split it at the space. The
  // managed command must use an encoded launcher so the path never appears raw
  // on the cmd.exe command line.
  it.skipIf(process.platform !== 'win32')(
    'wraps the managed hook command to survive spaces in the profile path (#6078)',
    () => {
      const spaceHome = join(tmpdir(), 'orca droid home with spaces')
      mkdirSync(spaceHome, { recursive: true })
      homedirMock.mockReturnValue(spaceHome)
      try {
        expect(new DroidHookService().install().state).toBe('installed')

        const hooks = parseJsonObject(
          readFileSync(join(spaceHome, '.factory', 'hooks.json'), 'utf8')
        )

        for (const eventName of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
          const command = eventEntries(hooks, eventName)[0]?.hooks[0]?.command
          expect(command).toMatch(WINDOWS_POWERSHELL_LAUNCHER)
        }
      } finally {
        rmSync(spaceHome, { recursive: true, force: true })
      }
    }
  )

  describe('remove', () => {
    it('takes Orca out of hooks.json and leaves the user entries and non-event keys', () => {
      const userStop = { hooks: [{ type: 'command', command: 'notify-send done' }] }
      writeJson(hooksJsonPath(), { hooksDisabled: false, Stop: [userStop] })
      const service = new DroidHookService()
      service.install()

      const status = service.remove()

      expect(status).toMatchObject({ state: 'not_installed', managedHooksPresent: false })
      expect(readJson(hooksJsonPath())).toEqual({ hooksDisabled: false, Stop: [userStop] })
    })

    it('also takes a not-yet-migrated Orca entry out of settings.json and keeps its other keys', () => {
      const orcaEntry = {
        hooks: [
          {
            type: 'command',
            command: `'${join(homeDir, '.orca', 'agent-hooks', 'droid-hook.sh')}'`
          }
        ]
      }
      writeJson(settingsJsonPath(), {
        disabledSkills: ['pdf'],
        hooks: { Stop: [orcaEntry], hooksDisabled: false }
      })

      new DroidHookService().remove()

      expect(readJson(settingsJsonPath())).toEqual({
        disabledSkills: ['pdf'],
        hooks: { hooksDisabled: false }
      })
    })

    it('creates no files when there is nothing to remove', () => {
      expect(new DroidHookService().remove().state).toBe('not_installed')

      expect(existsSync(hooksJsonPath())).toBe(false)
      expect(existsSync(settingsJsonPath())).toBe(false)
    })

    it('reports an error and writes nothing when a file cannot be parsed', () => {
      mkdirSync(dirname(hooksJsonPath()), { recursive: true })
      writeFileSync(hooksJsonPath(), '{ not json')

      expect(new DroidHookService().remove().state).toBe('error')
      expect(readFileSync(hooksJsonPath(), 'utf8')).toBe('{ not json')
    })
  })

  describe('status', () => {
    const DISABLED = 'Droid hooks are disabled in Factory settings'
    const orgSettingsPath = (): string => join(homeDir, 'org', 'settings.json')

    it('reads not installed on an empty home', () => {
      const status = new DroidHookService().getStatus()

      expect(status).toMatchObject({
        state: 'not_installed',
        managedHooksPresent: false,
        configPath: hooksJsonPath()
      })
    })

    it('reports partial when hooks.json turns hooks off', () => {
      writeJson(hooksJsonPath(), { hooksDisabled: true })

      const status = new DroidHookService().install()

      expect(status.state).toBe('partial')
      expect(status.managedHooksPresent).toBe(true)
      expect(status.detail).toBe(DISABLED)
    })

    it('reports partial when settings.json hooks.hooksDisabled turns hooks off', () => {
      writeJson(settingsJsonPath(), { hooks: { hooksDisabled: true } })

      const status = new DroidHookService().install()

      expect(status.state).toBe('partial')
      expect(status.detail).toBe(DISABLED)
    })

    it('ignores a top-level settings.json hooksDisabled, which Droid does not read', () => {
      writeJson(settingsJsonPath(), { hooksDisabled: true })

      expect(new DroidHookService().install()).toMatchObject({ state: 'installed', detail: null })
    })

    it('reads an event shadowed by the user hooks.json as missing, and install repairs it', () => {
      const service = new DroidHookService()
      service.install()
      const hooks = readHooks()
      // The Stop entry now lives only in settings.json while hooks.json replaces Stop.
      writeJson(settingsJsonPath(), { hooks: { Stop: hooks.Stop } })
      writeJson(hooksJsonPath(), {
        ...hooks,
        Stop: [{ hooks: [{ type: 'command', command: 'x' }] }]
      })

      expect(service.getStatus()).toMatchObject({
        state: 'partial',
        managedHooksPresent: true,
        detail: 'Managed hook missing for events: Stop'
      })

      expect(service.install().state).toBe('installed')
      expect(eventEntries(readHooks(), 'Stop')).toHaveLength(2)
    })

    it('treats an empty hooks.json event as shadowing the settings.json one', () => {
      const service = new DroidHookService()
      service.install()
      const hooks = readHooks()
      writeJson(settingsJsonPath(), { hooks: { Notification: hooks.Notification } })
      writeJson(hooksJsonPath(), { ...hooks, Notification: [] })

      expect(service.getStatus().detail).toBe('Managed hook missing for events: Notification')
    })

    it('counts an Orca entry that only settings.json defines, until migration moves it', () => {
      const service = new DroidHookService()
      service.install()
      writeJson(settingsJsonPath(), { hooks: readJson(hooksJsonPath()) })
      rmSync(hooksJsonPath())

      expect(service.getStatus()).toMatchObject({ state: 'installed', detail: null })
    })

    it('reads not installed again after the user deletes the entries', () => {
      const service = new DroidHookService()
      service.install()
      writeJson(hooksJsonPath(), {})

      expect(service.getStatus()).toMatchObject({
        state: 'not_installed',
        managedHooksPresent: false
      })
    })

    it.each([
      ['allowManagedHooksOnly: true', { allowManagedHooksOnly: true }, 'partial'],
      ['allowManagedHooksOnly: false', { allowManagedHooksOnly: false }, 'installed'],
      ['no such key', { model: 'x' }, 'installed']
    ])('organization policy with %s reads %s', (_label, policy, state) => {
      writeJson(orgSettingsPath(), policy)
      const service = new DroidHookService({ orgSettingsPath: orgSettingsPath() })

      const status = service.install()

      expect(status.state).toBe(state)
      if (state === 'partial') {
        expect(status.detail).toBe(
          'Droid ignores user hooks because your organization allows managed hooks only'
        )
        expect(status.managedHooksPresent).toBe(true)
      }
    })

    it('treats a missing or unreadable organization policy as not restricting hooks', () => {
      mkdirSync(dirname(orgSettingsPath()), { recursive: true })
      writeFileSync(orgSettingsPath(), '{ not json')

      expect(new DroidHookService({ orgSettingsPath: orgSettingsPath() }).install().state).toBe(
        'installed'
      )
      expect(
        new DroidHookService({ orgSettingsPath: join(homeDir, 'nope.json') }).install().state
      ).toBe('installed')
    })

    it.each([
      ['hooks.json', hooksJsonPath],
      ['settings.json', settingsJsonPath]
    ])('reports an error when %s cannot be parsed', (fileName, pathOf) => {
      mkdirSync(dirname(pathOf()), { recursive: true })
      writeFileSync(pathOf(), '{ not json')

      expect(new DroidHookService().getStatus()).toMatchObject({
        state: 'error',
        managedHooksPresent: false,
        detail: `Could not parse Factory ${fileName}`
      })
    })
  })
})
