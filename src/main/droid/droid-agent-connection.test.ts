import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipedProcessSpec } from '@orca/process-host/process-spec'
import type { ProviderProcessSpawner } from '../provider-process/provider-process-spawn'
import { createFakePipedChild } from '../../shared/__fixtures__/fake-spawned-child'
import { DroidAgentConnection, type DroidAgentConnectionOptions } from './droid-agent-connection'

// Protocol fixtures supply a provider child, not the native bootstrap's control pipes.
vi.mock('../provider-process/provider-process-spawn', () => ({
  spawnProviderProcess: (spec: PipedProcessSpec, spawn: ProviderProcessSpawner) => spawn(spec)
}))

const opened: {
  connection: DroidAgentConnection
  child: ReturnType<typeof createFakePipedChild>
}[] = []

function fixture(options: DroidAgentConnectionOptions = {}) {
  const child = Object.assign(createFakePipedChild(), {
    pid: 9_999_999,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough()
  })
  child.stdin.resume()
  child.stdin.once('finish', () => child.emit('exit', 0, null))
  const connection = new DroidAgentConnection(
    { command: 'fixture-droid', args: [], cwd: tmpdir() },
    options,
    () => child
  )
  opened.push({ connection, child })
  return { connection, child }
}

afterEach(async () => {
  for (const { connection, child } of opened.splice(0)) {
    child.emit('exit', 0, null)
    child.stdout.destroy()
    await connection.close()
  }
})

describe('the Droid process Orca owns', () => {
  it('settles a request with the exit once stdout closes', async () => {
    const onExit = vi.fn()
    const { connection, child } = fixture({ onExit })
    const pending = expect(connection.request('droid.add_user_message', {})).rejects.toThrow(
      'Droid process exited (code 7, signal none)'
    )

    child.emit('exit', 7, null)
    child.stdout.destroy()

    await pending
    expect(connection.rootVerdict).toBe('exited')
    expect(onExit).toHaveBeenCalledExactlyOnceWith(expect.any(Error), {
      expected: false,
      exit: { code: 7, signal: null, processless: false }
    })
  })

  it('delivers the last frames Droid wrote before it exited, then reports the exit', async () => {
    const notifications: unknown[] = []
    const atExit: unknown[][] = []
    const { connection, child } = fixture({
      onNotification: (method, params) => notifications.push({ method, params }),
      onExit: () => atExit.push([...notifications])
    })
    const pending = expect(connection.request('droid.add_user_message', {})).rejects.toThrow(
      'Droid process exited (code 0, signal none)'
    )

    child.emit('exit', 0, null)
    expect(atExit).toEqual([])
    child.stdout.end(
      '{"jsonrpc":"2.0","type":"notification","factoryApiVersion":"1.0.0","factoryProtocolVersion":"1.279.0","method":"droid.session_notification","params":{"sessionId":"00000000-0000-4000-8000-000000000001","notification":{"type":"droid_working_state_changed","newState":"idle"}}}\n'
    )

    await pending
    expect(atExit).toEqual([
      [
        {
          method: 'droid.session_notification',
          params: {
            sessionId: '00000000-0000-4000-8000-000000000001',
            notification: { type: 'droid_working_state_changed', newState: 'idle' }
          }
        }
      ]
    ])
  })

  it('reports a close it asked for as expected', async () => {
    const onExit = vi.fn()
    const { connection } = fixture({ onExit })

    expect(await connection.close()).toMatchObject({ root: 'exited' })

    expect(onExit).toHaveBeenCalledExactlyOnceWith(expect.any(Error), {
      expected: true,
      exit: { code: 0, signal: null, processless: false }
    })
  })
})
