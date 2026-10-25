import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runProcess } from '@orca/process-host'
import { readAgentProcessIdentity } from '../../shared/agent-process-presence'
import { probeAgentProcessPresence } from '../../shared/agent-process-presence-probe'
import { getDroidManagedCommand, getDroidManagedScript } from './droid-hook-script'

const PANE_KEY = 'presence-test-pane'

describe('Droid hook process capture', () => {
  it('captures the agent in the command shell, where $PPID is droid and not the script shell', () => {
    const command = getDroidManagedCommand('/home/u/.orca/agent-hooks/droid-hook.sh', 'posix')

    expect(command).toContain(
      '; then ORCA_HOOK_AGENT_PID="${PPID:-}"; export ORCA_HOOK_AGENT_PID; /bin/sh '
    )
  })

  it('has the script post the captured identity to the listener', () => {
    const script = getDroidManagedScript('posix')

    expect(script).toContain('orca_agent_process=')
    expect(script).toContain('--data-urlencode "agentProcess=${orca_agent_process:-}"')
  })

  it.skipIf(process.platform === 'win32')(
    'hands the spawning process, not the script shell, to the spooled hook record',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'orca-droid-presence-'))
      try {
        const dir = join(home, '.orca', 'agent-hooks')
        await mkdir(dir, { recursive: true })
        const scriptPath = join(dir, 'droid-hook.sh')
        await writeFile(scriptPath, getDroidManagedScript('posix'), { mode: 0o700 })
        await chmod(scriptPath, 0o700)
        const endpoint = join(dir, 'endpoint.env')
        await writeFile(endpoint, '')

        const result = await runProcess({
          program: '/usr/bin/env',
          args: [
            '-i',
            `HOME=${home}`,
            'PATH=/usr/bin:/bin',
            `ORCA_PANE_KEY=${PANE_KEY}`,
            `ORCA_AGENT_HOOK_ENDPOINT=${endpoint}`,
            '/bin/sh',
            '-c',
            getDroidManagedCommand(scriptPath, 'posix')
          ],
          input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's-1' }),
          timeoutMs: 5000
        })

        expect(result.code).toBe(0)
        const spooled = await readFile(join(dir, 'spool', `pane-${PANE_KEY}.jsonl`), 'utf8')
        const record = JSON.parse(spooled.trim())
        const identity = readAgentProcessIdentity(record.agentProcess)
        expect(identity?.pid).toBe(process.pid)
        expect(await probeAgentProcessPresence(identity)).toBe('live')
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    }
  )
})
