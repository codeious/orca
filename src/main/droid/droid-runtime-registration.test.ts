import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '@orca/process-host'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import {
  STRUCTURED_AGENT_RUNTIME_REGISTRATIONS,
  structuredAgentRuntimeRegistration
} from '../runtime/structured-agent-runtime-registrations'
import { DROID_AGENT, DROID_ACCOUNT_HOME_VARIABLE } from './droid-agent-definition'
import { DROID_RUNTIME_REGISTRATION, resolveDroidAccountHome } from './droid-runtime-registration'

vi.mock('@orca/process-host', () => ({ runProcess: vi.fn() }))

type LaunchInput = Parameters<NonNullable<typeof DROID_RUNTIME_REGISTRATION.supportsLaunch>>[0]
function supportsLaunch(launch: LaunchInput): Promise<boolean> {
  const check = DROID_RUNTIME_REGISTRATION.supportsLaunch
  if (!check) {
    throw new Error('Droid registers a launch check')
  }
  return check(launch)
}
function unsupportedVersion(launch: LaunchInput) {
  const check = DROID_RUNTIME_REGISTRATION.unsupportedVersion
  if (!check) {
    throw new Error('Droid registers a version check')
  }
  return check(launch)
}

let root: string
let stockDroid: string

function prints(stdout: string, result: Partial<Awaited<ReturnType<typeof runProcess>>> = {}) {
  vi.mocked(runProcess).mockResolvedValue({
    code: 0,
    signal: null,
    timedOut: false,
    stdout,
    stderr: '',
    ...result
  })
}

beforeEach(async () => {
  vi.mocked(runProcess).mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  root = await mkdtemp(join(tmpdir(), 'orca-droid-support-'))
  stockDroid = join(root, process.platform === 'win32' ? 'droid.cmd' : 'droid')
  await writeFile(stockDroid, '')
  await chmod(stockDroid, 0o755)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

const input = (commandSettings: LaunchInput['commandSettings'] = {}): LaunchInput => ({
  cwd: '/host/workspace',
  env: { PATH: root, HOME: '/host/home' },
  commandSettings
})

describe('the Droid registration', () => {
  it('is the runtime lookup for droid, placed after Claude and before the protocol agents', () => {
    const agents = STRUCTURED_AGENT_RUNTIME_REGISTRATIONS.map(({ definition }) => definition.agent)
    expect(structuredAgentRuntimeRegistration('droid')).toBe(DROID_RUNTIME_REGISTRATION)
    expect(DROID_RUNTIME_REGISTRATION.definition).toBe(DROID_AGENT)
    expect(agents.indexOf('droid')).toBe(agents.indexOf('claude') + 1)
  })

  it('runs on this machine outside WSL, and nowhere else', () => {
    const local = {
      executionHostId: LOCAL_EXECUTION_HOST_ID,
      wslDistro: null,
      workspaceId: 'folder-1',
      workspaceKind: 'folder'
    } as const
    expect(DROID_RUNTIME_REGISTRATION.supportsLocation(local)).toBe(true)
    expect(DROID_RUNTIME_REGISTRATION.supportsLocation({ ...local, wslDistro: 'Ubuntu' })).toBe(
      false
    )
    expect(
      DROID_RUNTIME_REGISTRATION.supportsLocation({ ...local, executionHostId: 'ssh:remote' })
    ).toBe(false)
  })

  it('pins a label for the home Droid itself reads, whatever else the launch sets', () => {
    expect(resolveDroidAccountHome({ launchEnv: { HOME: '/host/home' } })).toEqual({
      variable: DROID_ACCOUNT_HOME_VARIABLE,
      path: join('/host/home', '.factory')
    })
    expect(resolveDroidAccountHome({ launchEnv: {} })).toEqual({
      variable: DROID_ACCOUNT_HOME_VARIABLE,
      path: join(homedir(), '.factory')
    })
    expect(
      resolveDroidAccountHome({ launchEnv: { [DROID_ACCOUNT_HOME_VARIABLE]: '/elsewhere' } }).path
    ).toBe(join(homedir(), '.factory'))
  })
})

describe('Droid launch support before session creation', () => {
  it.each(['0.238.0', '0.300.1', '1.275.0', '0.238.0\n'])(
    'accepts a release from 0.238.0: %s',
    async (out) => {
      prints(out)
      await expect(supportsLaunch(input())).resolves.toBe(true)
      expect(runProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          program: stockDroid,
          cwd: '/host/workspace',
          args: ['--version']
        })
      )
    }
  )

  it.each(['0.237.9', '0.230.0', '0.300.0-rc.1', 'unknown', ''])(
    'keeps the terminal chat for an older, prerelease or unreadable version: %s',
    async (out) => {
      prints(out)
      await expect(supportsLaunch(input())).resolves.toBe(false)
    }
  )

  it.each([
    { code: 1, timedOut: false, outputTruncated: false },
    { code: 0, timedOut: true, outputTruncated: false },
    { code: 0, timedOut: false, outputTruncated: true }
  ])('does not infer support from incomplete or failed output: %j', async (result) => {
    prints('0.300.0', result)
    await expect(supportsLaunch(input())).resolves.toBe(false)
  })

  it('probes the binary the Command setting names, not the stock one', async () => {
    prints('0.300.0')
    await expect(
      supportsLaunch(input({ agentCmdOverrides: { droid: `"${process.execPath}"` } }))
    ).resolves.toBe(true)
    expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({ program: process.execPath }))
  })

  it('keeps the terminal chat, and names no release, when no droid is installed', async () => {
    const empty = join(root, 'empty')
    await mkdir(empty)
    vi.mocked(runProcess).mockRejectedValue(
      Object.assign(new Error('spawn droid ENOENT'), { code: 'ENOENT', path: 'droid' })
    )
    const notInstalled = { ...input(), env: { PATH: empty, HOME: '/host/home' } }

    await expect(supportsLaunch(notInstalled)).resolves.toBe(false)
    await expect(unsupportedVersion(notInstalled)).resolves.toBeNull()
  })

  it('leaves an unrunnable Command setting to the launch to refuse', async () => {
    await expect(
      supportsLaunch(input({ agentCmdOverrides: { droid: '/missing/droid' } }))
    ).resolves.toBe(true)
    expect(runProcess).not.toHaveBeenCalled()
  })
})

describe('Droid release named when it is too old', () => {
  it('is the installed release, the oldest the chat runs on, and the way to update', async () => {
    prints('0.230.0')
    await expect(unsupportedVersion(input())).resolves.toEqual({
      agentName: 'Droid',
      found: '0.230.0',
      floor: '0.238.0',
      updateCommand: 'droid update'
    })
  })

  it.each(['0.238.0', '1.275.0', '0.300.0-rc.1', 'unknown', ''])(
    'is nothing when age is not the reason: %s',
    async (out) => {
      prints(out)
      await expect(unsupportedVersion(input())).resolves.toBeNull()
    }
  )

  it('is nothing when the Command setting cannot run, which the launch refuses on its own', async () => {
    await expect(
      unsupportedVersion(input({ agentCmdOverrides: { droid: '/missing/droid' } }))
    ).resolves.toBeNull()
    expect(runProcess).not.toHaveBeenCalled()
  })
})
