import { describe, expect, it, vi } from 'vitest'
import { createAgentHookMemorySftp } from '../agent-hooks/agent-hook-memory-sftp.test-fixture'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/orca-user-data' } }))

import { getDroidManagedCommand } from './droid-hook-script'
import { eventEntries, parseJsonObject } from './droid-hooks-file.test-fixture'
import { DroidHookService } from './hook-service'

const HOME = '/home/dev'
const HOOKS_PATH = `${HOME}/.factory/hooks.json`
const SETTINGS_PATH = `${HOME}/.factory/settings.json`
const SCRIPT_PATH = `${HOME}/.orca/agent-hooks/droid-hook.sh`

describe('DroidHookService.installRemote', () => {
  it('installs Droid hooks into Factory hooks.json (issue #7253)', async () => {
    const { sftp, fs } = createAgentHookMemorySftp()

    const status = await new DroidHookService().installRemote(sftp, HOME)

    expect(status.state).toBe('installed')
    expect(status.configPath).toBe(HOOKS_PATH)
    const hooks = parseJsonObject(fs.files.get(HOOKS_PATH)!)
    const expectedCommand = getDroidManagedCommand(SCRIPT_PATH, 'posix')
    for (const eventName of [
      'SessionStart',
      'UserPromptSubmit',
      'Stop',
      'SubagentStop',
      'PreToolUse',
      'PostToolUse',
      'Notification'
    ]) {
      const command = eventEntries(hooks, eventName)[0]?.hooks[0]?.command
      expect(command).toBe(expectedCommand)
      expect(command).toMatch(/^if \[ -f /)
    }
    // Droid has no PermissionRequest event; Orca must not write one.
    expect(hooks.PermissionRequest).toBeUndefined()
    // Tool events carry a `*` matcher; lifecycle events do not.
    expect(eventEntries(hooks, 'PreToolUse')[0]?.matcher).toBe('*')
    expect(eventEntries(hooks, 'PostToolUse')[0]?.matcher).toBe('*')
    expect(eventEntries(hooks, 'Stop')[0]?.matcher).toBeUndefined()
    expect(fs.files.has(SETTINGS_PATH)).toBe(false)
    const script = fs.files.get(SCRIPT_PATH)
    expect(script).toContain('#!/bin/sh')
    expect(script).toContain('/hook/droid')
    expect(fs.modes.get(SCRIPT_PATH)).toBe(0o755)
  })

  it('moves an Orca entry out of settings.json and keeps the user entries (issue #51)', async () => {
    const orcaCommand = getDroidManagedCommand(SCRIPT_PATH, 'posix')
    const userStop = { hooks: [{ type: 'command', command: 'notify-send done' }] }
    const userStart = { hooks: [{ type: 'command', command: 'echo hi' }] }
    const { sftp, fs } = createAgentHookMemorySftp({
      [SETTINGS_PATH]: JSON.stringify({
        disabledSkills: ['pdf'],
        hooks: {
          SessionStart: [userStart],
          Stop: [userStop, { hooks: [{ type: 'command', command: orcaCommand }] }],
          PermissionRequest: [{ matcher: '*', hooks: [{ type: 'command', command: orcaCommand }] }]
        }
      })
    })

    const status = await new DroidHookService().installRemote(sftp, HOME)

    expect(status.state).toBe('installed')
    const hooks = parseJsonObject(fs.files.get(HOOKS_PATH)!)
    const sessionStart = eventEntries(hooks, 'SessionStart')
    const stop = eventEntries(hooks, 'Stop')
    expect(sessionStart).toHaveLength(2)
    expect(sessionStart[0]).toEqual(userStart)
    expect(stop).toHaveLength(2)
    expect(stop[0]).toEqual(userStop)
    expect(hooks.PermissionRequest).toBeUndefined()
    expect(parseJsonObject(fs.files.get(SETTINGS_PATH)!)).toEqual({
      disabledSkills: ['pdf'],
      hooks: { SessionStart: [userStart], Stop: [userStop] }
    })
  })

  it('leaves a settings.json that holds no Orca entry untouched', async () => {
    const original = `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] } }, null, 2)}\n`
    const { sftp, fs } = createAgentHookMemorySftp({ [SETTINGS_PATH]: original })

    await new DroidHookService().installRemote(sftp, HOME)

    expect(fs.files.get(SETTINGS_PATH)).toBe(original)
  })

  it('installs the same hooks.json tree twice without rewriting it', async () => {
    const { sftp, fs } = createAgentHookMemorySftp()
    const service = new DroidHookService()
    await service.installRemote(sftp, HOME)
    const first = fs.files.get(HOOKS_PATH)

    const status = await service.installRemote(sftp, `${HOME}/`)

    expect(status.state).toBe('installed')
    expect(fs.files.get(HOOKS_PATH)).toBe(first)
  })

  it('keeps the user hooks.json it replaces as hooks.json.bak', async () => {
    const original = `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] } }, null, 2)}\n`
    const { sftp, fs } = createAgentHookMemorySftp({ [HOOKS_PATH]: original })

    await new DroidHookService().installRemote(sftp, HOME)

    expect(fs.files.get(`${HOOKS_PATH}.bak`)).toBe(original)
    expect(fs.files.get(HOOKS_PATH)).not.toBe(original)
  })

  it('keeps the settings.json it moves an Orca entry out of as settings.json.bak', async () => {
    const original = `${JSON.stringify(
      {
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: getDroidManagedCommand(SCRIPT_PATH, 'posix') }] }
          ]
        }
      },
      null,
      2
    )}\n`
    const { sftp, fs } = createAgentHookMemorySftp({ [SETTINGS_PATH]: original })

    await new DroidHookService().installRemote(sftp, HOME)

    expect(fs.files.get(`${SETTINGS_PATH}.bak`)).toBe(original)
  })

  it('writes no backup on a first install, and none when the tree is already current', async () => {
    const original = `${JSON.stringify({ hooksDisabled: false }, null, 2)}\n`
    const fresh = createAgentHookMemorySftp()
    await new DroidHookService().installRemote(fresh.sftp, HOME)
    expect(fresh.fs.files.has(`${HOOKS_PATH}.bak`)).toBe(false)

    const existing = createAgentHookMemorySftp({ [HOOKS_PATH]: original })
    const service = new DroidHookService()
    await service.installRemote(existing.sftp, HOME)
    await service.installRemote(existing.sftp, HOME)
    // Why: the second install changes nothing, so it must not roll the backup onto Orca's own output.
    expect(existing.fs.files.get(`${HOOKS_PATH}.bak`)).toBe(original)
  })

  it.each(['hooks.json', 'settings.json'])(
    'does not overwrite a malformed remote Factory %s',
    async (fileName) => {
      const original = '{"hooks": }'
      const path = `${HOME}/.factory/${fileName}`
      const { sftp, fs } = createAgentHookMemorySftp({ [path]: original })

      const status = await new DroidHookService().installRemote(sftp, HOME)

      expect(status).toMatchObject({
        agent: 'droid',
        state: 'error',
        configPath: HOOKS_PATH,
        managedHooksPresent: false,
        detail: `Could not parse remote Factory ${fileName}`
      })
      expect(fs.files.get(path)).toBe(original)
      expect(fs.files.get(SCRIPT_PATH)).toBeUndefined()
    }
  )
})
