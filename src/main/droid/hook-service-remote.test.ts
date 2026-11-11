import { describe, expect, it, vi } from 'vitest'
import { createAgentHookMemorySftp } from '../agent-hooks/installation/remote/testing/agent-hook-memory-sftp.test-fixture'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/orca-user-data' } }))

import { eventEntries, parseJsonObject } from './droid-hooks-file.test-fixture'
import { DroidHookService } from './hook-service'

const HOME = '/home/dev'
const HOOKS_PATH = '/home/dev/.factory/hooks.json'
const SETTINGS_PATH = '/home/dev/.factory/settings.json'
const SCRIPT_PATH = '/home/dev/.orca/agent-hooks/droid-hook.sh'

describe('DroidHookService.installRemote', () => {
  it('installs Droid hooks into Factory hooks.json', async () => {
    const { sftp, fs } = createAgentHookMemorySftp()

    const status = await new DroidHookService().installRemote(sftp, HOME)

    expect(status).toMatchObject({ state: 'installed', configPath: HOOKS_PATH })
    const hooks = parseJsonObject(fs.files.get(HOOKS_PATH)!)
    expect(eventEntries(hooks, 'Stop')).toHaveLength(1)
    expect(hooks.PermissionRequest).toBeUndefined()
    expect(fs.files.has(SETTINGS_PATH)).toBe(false)
    expect(fs.modes.get(SCRIPT_PATH)).toBe(0o755)
  })

  it('moves an Orca entry out of settings.json and keeps the user entries', async () => {
    const userStop = { hooks: [{ type: 'command', command: 'notify-send done' }] }
    const { sftp, fs } = createAgentHookMemorySftp({
      [SETTINGS_PATH]:
        '{"disabledSkills":["pdf"],"hooks":{"Stop":[{"hooks":[{"type":"command","command":"notify-send done"}]},{"hooks":[{"command":"/old/.orca/agent-hooks/droid-hook.sh"}]}],"PermissionRequest":[{"hooks":[{"command":"/old/.orca/agent-hooks/droid-hook.sh"}]}]}}\n'
    })

    expect((await new DroidHookService().installRemote(sftp, HOME)).state).toBe('installed')

    const hooks = parseJsonObject(fs.files.get(HOOKS_PATH)!)
    expect(eventEntries(hooks, 'Stop')).toHaveLength(2)
    expect(eventEntries(hooks, 'Stop')[0]).toEqual(userStop)
    expect(hooks.PermissionRequest).toBeUndefined()
    expect(parseJsonObject(fs.files.get(SETTINGS_PATH)!)).toEqual({
      disabledSkills: ['pdf'],
      hooks: { Stop: [userStop] }
    })
  })

  it('leaves a settings.json that holds no Orca entry untouched', async () => {
    const original = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo mine"}]}]}}\n'
    const { sftp, fs } = createAgentHookMemorySftp({ [SETTINGS_PATH]: original })

    await new DroidHookService().installRemote(sftp, HOME)

    expect(fs.files.get(SETTINGS_PATH)).toBe(original)
    expect(fs.files.has(`${SETTINGS_PATH}.bak`)).toBe(false)
  })

  it('backs up migrated files once and preserves the backups on an unchanged reinstall', async () => {
    const fresh = createAgentHookMemorySftp()
    await new DroidHookService().installRemote(fresh.sftp, HOME)
    expect(fresh.fs.files.has(`${HOOKS_PATH}.bak`)).toBe(false)

    const hooks = '{"Stop":[{"hooks":[{"command":"echo mine"}]}]}\n'
    const settings =
      '{"hooks":{"Stop":[{"hooks":[{"command":"/old/.orca/agent-hooks/droid-hook.sh"}]}]}}\n'
    const { sftp, fs } = createAgentHookMemorySftp({
      [HOOKS_PATH]: hooks,
      [SETTINGS_PATH]: settings
    })
    const service = new DroidHookService()
    await service.installRemote(sftp, HOME)
    await service.installRemote(sftp, '/home/dev/')

    expect(fs.files.get(`${HOOKS_PATH}.bak`)).toBe(hooks)
    expect(fs.files.get(`${SETTINGS_PATH}.bak`)).toBe(settings)
    expect(parseJsonObject(fs.files.get(SETTINGS_PATH)!)).toEqual({ hooks: {} })
  })

  it.each(['hooks.json', 'settings.json'])(
    'does not overwrite a malformed remote Factory %s',
    async (fileName) => {
      const path = `/home/dev/.factory/${fileName}`
      const { sftp, fs } = createAgentHookMemorySftp({ [path]: '{"hooks": }' })

      expect(await new DroidHookService().installRemote(sftp, HOME)).toMatchObject({
        state: 'error',
        configPath: HOOKS_PATH,
        managedHooksPresent: false
      })
      expect(fs.files.get(path)).toBe('{"hooks": }')
      expect(fs.files.has(SCRIPT_PATH)).toBe(false)
    }
  )

  it.each([
    ['linux', '/etc/factory/settings.json'],
    ['darwin', '/Library/Application Support/Factory/settings.json']
  ] as const)('reports the %s execution host organization policy', async (platform, path) => {
    const { sftp, fs } = createAgentHookMemorySftp({
      [path]: '{"allowManagedHooksOnly":true}'
    })

    expect(await new DroidHookService().installRemote(sftp, HOME, platform)).toMatchObject({
      state: 'partial',
      managedHooksPresent: true
    })
    expect(fs.files.get(path)).toBe('{"allowManagedHooksOnly":true}')
  })

  it('does not claim a disabled remote install is active', async () => {
    const { sftp, fs } = createAgentHookMemorySftp({
      [HOOKS_PATH]: '{"hooksDisabled":true}'
    })

    expect(await new DroidHookService().installRemote(sftp, HOME)).toMatchObject({
      state: 'partial',
      managedHooksPresent: true
    })
    expect(parseJsonObject(fs.files.get(HOOKS_PATH)!).hooksDisabled).toBe(true)
  })
})
