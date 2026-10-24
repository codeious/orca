// Real-CLI check that Droid loads the hooks.json Orca writes. Skipped unless opted in:
//   ORCA_REAL_DROID_CLI_TEST=1 pnpm test src/main/droid/hook-service-real-cli.test.ts
// Everything runs under a throwaway HOME; the machine's ~/.factory is never read or written.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcessSync } from '@orca/process-host'

const { getPathMock, homedirMock } = vi.hoisted(() => ({
  getPathMock: vi.fn<(name: string) => string>(),
  homedirMock: vi.fn<() => string>()
}))

vi.mock('electron', () => ({ app: { getPath: getPathMock } }))

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as Record<string, unknown>
  return { ...actual, homedir: homedirMock }
})

import { parseJsonObject } from './droid-hooks-file.test-fixture'
import { DroidHookService } from './hook-service'
import { openDroidTestSession, type DroidTestSession } from './droid-real-cli-session-test-support'
import { resolveRealDroidCliGate } from './droid-real-cli-test-gate'

const gate = resolveRealDroidCliGate(process.env, process.platform, (args) => {
  try {
    return { status: runProcessSync({ program: 'droid', args, timeoutMs: 10_000 }).code }
  } catch {
    return { status: null }
  }
})

const HOOK_TOKEN = 'real-cli-test-token'

describe.skipIf(gate.skipReason !== null)(
  'Droid loads the hooks.json Orca writes (real CLI)',
  () => {
    let root: string
    let home: string
    let project: string
    let userHookLog: string
    let server: Server
    let session: DroidTestSession | null
    let posted: { token: string | undefined; event: string | undefined }[]

    const settingsPath = (): string => join(home, '.factory', 'settings.json')
    const hooksPath = (): string => join(home, '.factory', 'hooks.json')
    const writeJson = (path: string, value: unknown): void => {
      mkdirSync(join(home, '.factory'), { recursive: true })
      writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
    }
    const orcaEvents = (): (string | undefined)[] => posted.map((request) => request.event)

    beforeEach(async () => {
      root = mkdtempSync(join(tmpdir(), 'orca-droid-real-cli-'))
      home = join(root, 'home')
      project = join(root, 'project')
      userHookLog = join(root, 'user-hook.log')
      mkdirSync(home, { recursive: true })
      mkdirSync(project, { recursive: true })
      homedirMock.mockReturnValue(home)
      getPathMock.mockImplementation((name: string) => {
        if (name === 'userData') {
          return join(root, 'user-data')
        }
        throw new Error(`unexpected getPath(${name})`)
      })
      posted = []
      session = null
      server = createServer((request, response) => {
        let body = ''
        request.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        request.on('end', () => {
          const payload = new URLSearchParams(body).get('payload')
          posted.push({
            token: request.headers['x-orca-agent-hook-token']?.toString(),
            event: payload ? JSON.parse(payload).hook_event_name : undefined
          })
          response.end('ok')
        })
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    })

    afterEach(async () => {
      await session?.close()
      await new Promise((resolve) => server.close(resolve))
      rmSync(root, { recursive: true, force: true })
    })

    function droidEnv(): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = { ...process.env }
      for (const key of Object.keys(env)) {
        if (key.startsWith('ORCA_') || key.startsWith('FACTORY_')) {
          delete env[key]
        }
      }
      const address = server.address()
      return {
        ...env,
        HOME: home,
        USERPROFILE: home,
        FACTORY_DISABLE_KEYRING: '1',
        FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false',
        ORCA_AGENT_HOOK_PORT: String(typeof address === 'object' && address ? address.port : 0),
        ORCA_AGENT_HOOK_TOKEN: HOOK_TOKEN,
        ORCA_PANE_KEY: 'real-cli-pane',
        ORCA_TAB_ID: 'real-cli-tab',
        ORCA_WORKTREE_ID: 'real-cli-worktree',
        ORCA_AGENT_HOOK_ENV: 'test',
        ORCA_AGENT_HOOK_VERSION: '1'
      }
    }

    // The org policy file of the machine running the test must not decide the outcome.
    const newService = (): DroidHookService =>
      new DroidHookService({ orgSettingsPath: join(root, 'no-org-policy.json') })

    it('fires Orca SessionStart and still fires the user hook carried over from settings.json', async () => {
      writeJson(settingsPath(), {
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: `echo user-hook >> '${userHookLog}'` }] }
          ]
        }
      })
      const service = newService()
      expect(service.install().state).toBe('installed')

      session = await openDroidTestSession({ cwd: project, env: droidEnv() })

      await vi.waitFor(
        () => {
          expect(orcaEvents()).toContain('SessionStart')
          expect(existsSync(userHookLog)).toBe(true)
        },
        { timeout: 15_000, interval: 250 }
      )
      expect(posted.every((request) => request.token === HOOK_TOKEN)).toBe(true)
      expect(readFileSync(userHookLog, 'utf8').trim()).toBe('user-hook')
    }, 60_000)

    it('goes quiet when hooks.json turns hooks off, as getStatus reports', async () => {
      const service = newService()
      service.install()
      const installed = parseJsonObject(readFileSync(hooksPath(), 'utf8'))
      writeJson(hooksPath(), { ...installed, hooksDisabled: true })

      expect(service.getStatus()).toMatchObject({
        state: 'partial',
        detail: 'Droid hooks are disabled in Factory settings'
      })

      session = await openDroidTestSession({ cwd: project, env: droidEnv() })
      // The enabled case fires within a second or so; wait well past that before asserting silence.
      await new Promise((resolve) => setTimeout(resolve, 5_000))

      expect(orcaEvents()).toEqual([])
    }, 60_000)
  }
)
