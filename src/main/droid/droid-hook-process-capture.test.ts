import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { describe, expect, it } from 'vitest'
import { readAgentProcessIdentity } from '../../shared/agent-process-presence'
import { probeAgentProcessPresence } from '../../shared/agent-process-presence-probe'
import { getDroidManagedCommand, getDroidManagedScript } from './droid-hook-script'

describe.skipIf(process.platform === 'win32')('Droid command-shell process capture', () => {
  it('posts the agent identity, not the managed shell, with a quoted script path', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-droid-capture-'))
    const posted: URLSearchParams[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      request.on('end', () => {
        posted.push(new URLSearchParams(body))
        response.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Expected loopback port')
      }
      const path = join(home, "Droid hook 'quoted'.sh")
      await writeFile(path, getDroidManagedScript('posix'), { mode: 0o700 })
      const payload = JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'lead',
        prompt: 'hello'
      })
      const result = await runProcess({
        program: '/bin/sh',
        args: ['-c', getDroidManagedCommand(path, 'posix')],
        input: payload,
        timeoutMs: 5_000,
        env: {
          HOME: home,
          PATH: '/usr/bin:/bin',
          TZ: 'Asia/Tokyo',
          ORCA_PANE_KEY: 'tab:leaf',
          ORCA_AGENT_HOOK_PORT: String(address.port),
          ORCA_AGENT_HOOK_TOKEN: 'capture-test-token'
        }
      })
      expect(result.code).toBe(0)
      expect(result.timedOut).toBe(false)
      expect(result.stdout).toBe('')
      expect(posted).toHaveLength(1)
      expect(posted[0].get('payload')).toBe(payload)
      const identity = readAgentProcessIdentity(posted[0].get('agentProcess'))
      expect(identity?.pid).toBe(process.pid)
      expect(await probeAgentProcessPresence(identity)).toBe('live')
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
      await rm(home, { recursive: true, force: true })
    }
  })

  it.each(['missing', 'not-executable'] as const)(
    'silently drains stdin for a %s managed script',
    async (state) => {
      const home = await mkdtemp(join(tmpdir(), 'orca-droid-hook-guard-'))
      try {
        const path = join(home, 'droid-hook.sh')
        if (state === 'not-executable') {
          await writeFile(path, 'exit 23\n', { mode: 0o600 })
        }
        const result = await runProcess({
          program: '/bin/sh',
          args: ['-c', getDroidManagedCommand(path, 'posix')],
          input: '{"hook_event_name":"Stop"}',
          timeoutMs: 5_000,
          env: { HOME: home, PATH: '/usr/bin:/bin' }
        })
        expect(result.code).toBe(0)
        expect(result.timedOut).toBe(false)
        expect(result.stdout).toBe('')
        expect(result.stderr).toBe('')
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    }
  )
})
