import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipedProcessSpawner } from '@orca/process-host/process-spec'
import { createFakePipedChild } from '../../shared/__fixtures__/fake-spawned-child'
import { providerExecutableMissing } from '../provider-process/provider-executable-missing'
import type { terminateProviderProcessTree } from '../provider-process/provider-process-teardown'
import { DroidAgentConnection, type DroidAgentConnectionOptions } from './droid-agent-connection'

const teardown = vi.hoisted(() =>
  vi.fn<typeof terminateProviderProcessTree>(async () => 'unverifiable')
)
vi.mock('../provider-process/provider-process-teardown', () => ({
  terminateProviderProcessTree: teardown
}))
const opened: { connection: DroidAgentConnection; exit: () => void }[] = []

function fixture(
  options: DroidAgentConnectionOptions = {},
  behavior: { exitOnEnd?: boolean; processless?: boolean } = {}
) {
  const child = Object.assign(createFakePipedChild(), {
    pid: behavior.processless ? undefined : 9_999_999,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true)
  })
  const written: Record<string, unknown>[] = []
  child.stdin.setEncoding('utf8')
  child.stdin.on('data', (chunk: string) => {
    for (const line of chunk.split('\n').filter(Boolean)) {
      written.push(JSON.parse(line))
    }
  })
  const spawn = vi.fn<PipedProcessSpawner>(() => child)
  if (behavior.exitOnEnd !== false) {
    child.stdin.once('finish', () => child.emit('exit', 0, null))
  }
  const connection = new DroidAgentConnection(
    {
      command: 'fixture-droid',
      args: ['exec', '--input-format', 'stream-jsonrpc', '--output-format', 'stream-jsonrpc'],
      cwd: '/execution-host/folder',
      env: { KEPT: 'yes', STRIPPED: 'overlay' },
      envToDelete: ['STRIPPED']
    },
    options,
    spawn
  )
  opened.push({ connection, exit: () => child.emit('exit', 0, null) })
  return { child, spawn, connection, written }
}
afterEach(async () => {
  for (const { connection, exit } of opened.splice(0)) {
    exit()
    await connection.close()
  }
  teardown.mockReset().mockResolvedValue('unverifiable')
  vi.useRealTimers()
})

const response = (id: unknown, result: unknown) =>
  `${JSON.stringify({ jsonrpc: '2.0', type: 'response', factoryProtocolVersion: '1.275.0', id, result })}\n`

describe('the Droid process Orca owns', () => {
  it('starts from the host-resolved launch and answers a request with its reply and protocol', async () => {
    const { connection, child, spawn, written } = fixture()

    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        cwd: '/execution-host/folder',
        env: expect.objectContaining({ KEPT: 'yes' }),
        stdio: ['pipe', 'pipe', 'pipe']
      })
    )
    expect(spawn.mock.calls[0][0].env).not.toHaveProperty('STRIPPED')
    const pending = connection.request('droid.initialize_session', {
      cwd: '/execution-host/folder'
    })
    await vi.waitFor(() => expect(written).toHaveLength(1))
    child.stdout.write(response(written[0].id, { sessionId: 's-1' }))

    expect(await pending).toEqual({ sessionId: 's-1' })
    expect(connection.protocolVersion).toBe('1.275.0')
    expect(await connection.close()).toEqual({ root: 'exited', tree: null })
  })

  it('hands the session notifications Droid volunteers to the handler', async () => {
    const onNotification = vi.fn()
    const { child } = fixture({ onNotification })
    const params = { notification: { type: 'droid_working_state_changed', newState: 'idle' } }

    child.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', type: 'notification', method: 'droid.session_notification', params })}\n`
    )

    await vi.waitFor(() =>
      expect(onNotification).toHaveBeenCalledWith('droid.session_notification', params)
    )
  })

  it('settles open requests on a proven exit with stdout still open, and keeps stderr out of the error', async () => {
    vi.useFakeTimers()
    const onExit = vi.fn()
    const { connection, child } = fixture({ onExit })
    const pending = expect(connection.request('droid.add_user_message', {})).rejects.toThrow(
      'code 7'
    )

    child.stderr.write('sensitive stderr text')
    child.emit('exit', 7, null)
    await vi.advanceTimersByTimeAsync(1_000)

    await pending
    expect(connection.rootVerdict).toBe('exited')
    expect(onExit).toHaveBeenCalledExactlyOnceWith(expect.any(Error), {
      expected: false,
      exit: { code: 7, signal: null, processless: false }
    })
    expect(onExit.mock.calls[0][0].message).not.toContain('sensitive')
  })

  it('delivers the last frames Droid wrote before it exited, then reports the exit', async () => {
    const onNotification = vi.fn()
    const onExit = vi.fn()
    const { connection, child } = fixture({ onNotification, onExit })
    const request = expect(connection.request('droid.add_user_message', {})).rejects.toThrow(
      'exited'
    )

    child.emit('exit', 0, null)
    expect(onExit).not.toHaveBeenCalled()
    child.stdout.end(
      `${JSON.stringify({ jsonrpc: '2.0', type: 'notification', method: 'droid.session_notification', params: { n: 1 } })}\n`
    )

    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce())
    expect(onNotification).toHaveBeenCalledOnce()
    await request
  })

  it('reports a close it asked for as expected', async () => {
    const onExit = vi.fn()
    const { connection } = fixture({ onExit })

    await connection.close()

    expect(onExit).toHaveBeenCalledExactlyOnceWith(
      expect.any(Error),
      expect.objectContaining({ expected: true })
    )
  })

  it('stops a Droid that closed its output but kept running, rather than wait on it for good', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const { connection, child } = fixture({ onClose }, { exitOnEnd: false })
    const pending = expect(connection.request('droid.add_user_message', {})).rejects.toThrow(
      'closed'
    )

    child.stdout.emit('end')
    await vi.advanceTimersByTimeAsync(249)
    expect(onClose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    await pending
    expect(onClose).toHaveBeenCalledOnce()
    expect(child.stdin.writableEnded).toBe(true)
    child.emit('exit', 0, null)
    await connection.close()
  })

  it('treats a failed spawn as no process, proven only once the spawner reports it closed', async () => {
    const onExit = vi.fn()
    const { connection, child } = fixture({ onExit }, { processless: true, exitOnEnd: false })
    const pending = expect(connection.request('droid.add_user_message', {})).rejects.toThrow(
      'ENOENT'
    )

    child.emit('error', new Error('ENOENT'))
    await pending
    expect(connection.rootVerdict).toBe('unverifiable')
    child.emit('close', null, null)

    expect(connection.rootVerdict).toBe('exited')
    expect(connection.processless).toBe(true)
    expect(onExit.mock.calls[0][1].exit.processless).toBe(true)
  })

  describe('when the droid executable is not installed', () => {
    const spawnFailure = (code: string, path: string) =>
      Object.assign(new Error(`spawn ${path} ${code}`), { code, path })

    it('marks the failure a request ends with, so the start reads as a missing CLI', async () => {
      const { connection, child } = fixture({}, { processless: true, exitOnEnd: false })
      const pending = connection.request('droid.initialize_session', {})
      const failed = pending.catch((error: unknown) => error)

      child.emit('error', spawnFailure('ENOENT', 'fixture-droid'))
      child.emit('close', null, null)

      expect(providerExecutableMissing(await failed)).toBe(true)
    })

    it('marks the exit it reports for a spawn that never started a process', async () => {
      const onExit = vi.fn()
      const { child } = fixture({ onExit }, { processless: true, exitOnEnd: false })

      child.emit('error', spawnFailure('ENOENT', 'fixture-droid'))
      child.emit('close', null, null)

      expect(onExit).toHaveBeenCalledOnce()
      expect(providerExecutableMissing(onExit.mock.calls[0][0])).toBe(true)
    })

    it.each([
      ['a spawn that fails for another reason', spawnFailure('EACCES', 'fixture-droid')],
      ['a missing interpreter, not the command', spawnFailure('ENOENT', '/usr/bin/env')]
    ])('does not mark %s', async (_name, failure) => {
      const { connection, child } = fixture({}, { processless: true, exitOnEnd: false })
      const failed = connection
        .request('droid.initialize_session', {})
        .catch((error: unknown) => error)

      child.emit('error', failure)
      child.emit('close', null, null)

      expect(providerExecutableMissing(await failed)).toBe(false)
    })
  })

  it('refuses limits it cannot honour before it starts a process', () => {
    const spawn = vi.fn<PipedProcessSpawner>()

    expect(
      () =>
        new DroidAgentConnection(
          { command: 'fixture', args: [] },
          { peer: { requestTimeoutMs: 0 } },
          spawn
        )
    ).toThrow('timer duration')
    expect(spawn).not.toHaveBeenCalled()
  })
})
