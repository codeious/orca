import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeOs from 'node:os'
import { removeTreeSync } from '../../shared/file-write/windows-transient-lock-removal'

const hoisted = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeOs>()
  return { ...actual, homedir: () => hoisted.home }
})

import { DroidHookService } from './hook-service'
import { eventEntries, parseJsonObject } from './droid-hooks-file.test-fixture'

const userHook = { hooks: [{ type: 'command', command: 'echo user-hook' }] }

describe('DroidHookService', () => {
  let root: string
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
    root = mkdtempSync(join(tmpdir(), 'orca-droid-home-'))
    hoisted.home = join(root, 'home')
    hooksPath = join(hoisted.home, '.factory', 'hooks.json')
    settingsPath = join(hoisted.home, '.factory', 'settings.json')
    orgPath = join(root, 'org.json')
    service = new DroidHookService({ orgSettingsPath: orgPath })
  })

  afterEach(() => {
    removeTreeSync(root)
  })

  it('removes a managed PermissionRequest command and keeps a user command', () => {
    write(settingsPath, {
      hooks: {
        PermissionRequest: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: '/old/path/.orca/agent-hooks/droid-hook.sh' }]
          },
          {
            matcher: 'Edit',
            hooks: [{ type: 'command', command: '/usr/local/bin/my-approval.sh' }]
          }
        ]
      }
    })

    const status = service.install()

    expect(status).toMatchObject({ state: 'installed', configPath: hooksPath })
    expect(read(hooksPath).PermissionRequest).toBeUndefined()
    expect(read(settingsPath)).toEqual({
      hooks: {
        PermissionRequest: [
          {
            matcher: 'Edit',
            hooks: [{ type: 'command', command: '/usr/local/bin/my-approval.sh' }]
          }
        ]
      }
    })
  })

  it('migrates only managed entries and retains user hooks and unrelated settings', () => {
    const original =
      '{"disabledSkills":["pdf"],"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo user-hook"}]}],"Stop":[{"hooks":[{"type":"command","command":"echo user-hook"}]},{"hooks":[{"command":"/old/.orca/agent-hooks/droid-hook.sh"}]}]}}\n'
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(settingsPath, original)

    expect(service.install()).toMatchObject({
      state: 'installed',
      configPath: hooksPath,
      managedHooksPresent: true
    })
    const hooks = read(hooksPath)
    expect(hooks.hooks).toBeUndefined()
    expect(eventEntries(hooks, 'Stop')).toHaveLength(2)
    expect(eventEntries(hooks, 'Stop')[0]).toEqual(userHook)
    expect(eventEntries(hooks, 'SessionStart')[0]).toEqual(userHook)
    expect(read(settingsPath)).toEqual({
      disabledSkills: ['pdf'],
      hooks: { SessionStart: [userHook], Stop: [userHook] }
    })
    expect(readFileSync(`${settingsPath}.bak`, 'utf8')).toBe(original)

    expect(service.remove().managedHooksPresent).toBe(false)
    expect(eventEntries(read(hooksPath), 'Stop')).toEqual([userHook])
    expect(read(settingsPath).disabledSkills).toEqual(['pdf'])
  })

  it('repairs a shadowed event without changing non-event keys or unrelated settings bytes', () => {
    const original = '{"theme":"dark"}\n'
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(settingsPath, original)
    service.install()
    write(hooksPath, { ...read(hooksPath), Stop: [userHook], metadata: { custom: true } })

    expect(service.getStatus().state).toBe('partial')
    expect(service.install().state).toBe('installed')
    expect(eventEntries(read(hooksPath), 'Stop')).toHaveLength(2)
    expect(eventEntries(read(hooksPath), 'Stop')[0]).toEqual(userHook)
    expect(read(hooksPath).metadata).toEqual({ custom: true })
    expect(readFileSync(settingsPath, 'utf8')).toBe(original)
    expect(existsSync(`${settingsPath}.bak`)).toBe(false)
  })

  it('preserves the last recoverable backup on an unchanged reinstall', () => {
    const original = '{"Stop":[{"hooks":[{"type":"command","command":"echo user-hook"}]}]}\n'
    mkdirSync(dirname(hooksPath), { recursive: true })
    writeFileSync(hooksPath, original)

    service.install()
    service.install()

    expect(readFileSync(`${hooksPath}.bak`, 'utf8')).toBe(original)
    expect(service.remove().managedHooksPresent).toBe(false)
    service.remove()
    expect(read(hooksPath)).toEqual({ Stop: [userHook] })
  })

  it.each(['hooks.json', 'settings.json'])(
    'refuses malformed %s before writing a script',
    (file) => {
      const path = join(hoisted.home, '.factory', file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, '{invalid')

      expect(service.install()).toMatchObject({ state: 'error', configPath: hooksPath })
      expect(readFileSync(path, 'utf8')).toBe('{invalid')
      expect(existsSync(join(hoisted.home, '.orca', 'agent-hooks', 'droid-hook.sh'))).toBe(false)
      expect(existsSync(join(hoisted.home, '.orca', 'agent-hooks', 'droid-hook.cmd'))).toBe(false)
    }
  )

  it.each([
    ['home/.factory/hooks.json', { hooksDisabled: true }],
    ['home/.factory/settings.json', { hooks: { hooksDisabled: true } }],
    ['org.json', { allowManagedHooksOnly: true }]
  ])('reports the disable policy in %s without clearing it', (file, policy) => {
    write(join(root, file), policy)

    expect(service.install()).toMatchObject({
      state: 'partial',
      configPath: hooksPath,
      managedHooksPresent: true
    })
    service.remove()
    expect(service.getStatus().state).toBe('partial')
  })

  it('ignores the top-level settings switch that Droid itself ignores', () => {
    write(settingsPath, { hooksDisabled: true })

    expect(service.install().state).toBe('installed')
    expect(read(settingsPath).hooksDisabled).toBe(true)
  })
})
