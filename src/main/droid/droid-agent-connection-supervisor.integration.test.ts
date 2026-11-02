import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DroidAgentConnection } from './droid-agent-connection'

// Closes its stdout and keeps running, as a wedged Droid would; like Droid it exits on its stdin end.
const ENDS_STDOUT_AND_STAYS_ALIVE_DROID = String.raw`
  const { writeFileSync } = require('node:fs')
  writeFileSync(process.env.ORCA_TEST_PID_FILE, String(process.pid))
  process.stdin.on('end', () => process.exit(0)).resume()
  setTimeout(() => {
    writeFileSync(process.env.ORCA_TEST_OUTPUT_ENDED_FILE, String(Date.now()))
    process.stdout.end()
  }, 200)
  setInterval(() => {}, 60000)
`

const tempDirs: string[] = []
const opened: DroidAgentConnection[] = []

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  for (const connection of opened.splice(0)) {
    const supervisor = connection.pid
    await connection.close().catch(() => undefined)
    if (supervisor !== undefined && alive(supervisor)) {
      process.kill(supervisor, 'SIGKILL')
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The unit case in droid-agent-connection.test.ts emits 'end' on a fake child, which skips the
// supervisor that real launches go through; only this one sees what the supervisor lets reach Orca.
describe.runIf(process.platform !== 'win32')('the Droid process behind its supervisor', () => {
  it('closes the peer 250 ms after Droid ends its output but keeps running, then stops Droid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-droid-connection-'))
    tempDirs.push(dir)
    const pidFile = join(dir, 'droid-pid')
    const endedFile = join(dir, 'output-ended-at')
    const onClose = vi.fn()
    const connection = new DroidAgentConnection(
      {
        command: process.execPath,
        args: ['-e', ENDS_STDOUT_AND_STAYS_ALIVE_DROID],
        env: { ORCA_TEST_PID_FILE: pidFile, ORCA_TEST_OUTPUT_ENDED_FILE: endedFile }
      },
      { onClose }
    )
    opened.push(connection)

    let settled: unknown
    void connection.request('droid.add_user_message', {}).then(
      () => {
        settled = 'resolved'
      },
      (error: unknown) => {
        settled = error
      }
    )
    await vi.waitFor(() => expect(settled).toBeDefined(), { timeout: 5_000 })
    // ast-grep-ignore: test-no-wall-clock -- Measure the real supervisor's grace against the child process's timestamp.
    const settledAt = Date.now()

    expect(settled).toMatchObject({ message: 'Droid closed its output' })
    // A timer may fire a tick early against another process's clock.
    expect(settledAt - Number(readFileSync(endedFile, 'utf8'))).toBeGreaterThanOrEqual(240)
    expect(settledAt - Number(readFileSync(endedFile, 'utf8'))).toBeLessThan(1_500)
    expect(onClose).toHaveBeenCalledOnce()
    const droid = Number(readFileSync(pidFile, 'utf8'))
    await vi.waitFor(() => expect(alive(droid)).toBe(false), { timeout: 5_000 })
  })
})
