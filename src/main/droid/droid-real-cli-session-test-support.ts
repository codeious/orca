import { spawnProcess } from '@orca/process-host'

// Matches the envelope Droid's own stream-jsonrpc client sends.
const FACTORY_API_VERSION = '1.0.0'
const FACTORY_PROTOCOL_VERSION = '1.201.1'

type RpcFrame = { type?: string; id?: string; error?: unknown }

export type DroidTestSession = { close: () => Promise<void> }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Starts `droid exec` over stream-jsonrpc and initializes a session without sending a prompt, which
 * is enough for Droid to load its hook config and fire SessionStart. No model call is made.
 */
export async function openDroidTestSession(options: {
  cwd: string
  env: NodeJS.ProcessEnv
}): Promise<DroidTestSession> {
  const child = spawnProcess({
    program: 'droid',
    args: ['exec', '--input-format', 'stream-jsonrpc', '--output-format', 'stream-jsonrpc'],
    cwd: options.cwd,
    env: options.env,
    stdio: 'pipe'
  })
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  const waiting = new Map<string, (frame: RpcFrame) => void>()
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  let buffered = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buffered += chunk.toString()
    for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
      const line = buffered.slice(0, end)
      buffered = buffered.slice(end + 1)
      try {
        const frame: RpcFrame = JSON.parse(line)
        if (frame.type === 'response' && frame.id !== undefined) {
          waiting.get(frame.id)?.(frame)
        }
      } catch {
        // Non-JSON output is not a response.
      }
    }
  })

  let nextId = 0
  const request = (method: string, params: Record<string, unknown>): Promise<RpcFrame> => {
    const id = `req-${(nextId += 1)}`
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        factoryApiVersion: FACTORY_API_VERSION,
        factoryProtocolVersion: FACTORY_PROTOCOL_VERSION,
        type: 'request',
        id,
        method,
        params
      })}\n`
    )
    return new Promise((resolve) => waiting.set(id, resolve))
  }

  const close = async (): Promise<void> => {
    await Promise.race([request('droid.close_session', {}), sleep(4_000)])
    child.stdin.end()
    const killer = setTimeout(() => child.kill('SIGTERM'), 3_000)
    await exited
    clearTimeout(killer)
  }

  const initialized = await Promise.race([
    request('droid.initialize_session', {
      machineId: 'orca-real-cli-test',
      cwd: options.cwd,
      interactionMode: 'auto',
      autonomyLevel: 'off'
    }),
    sleep(20_000).then((): RpcFrame => ({ error: 'timed out waiting for initialize_session' }))
  ])
  if (initialized.error !== undefined) {
    child.kill('SIGTERM')
    await exited
    throw new Error(
      `droid initialize_session failed: ${JSON.stringify(initialized.error)}\n${stderr.slice(-500)}`
    )
  }
  return { close }
}
