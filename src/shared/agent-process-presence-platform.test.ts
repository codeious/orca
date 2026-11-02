import { afterEach, describe, expect, it, vi } from 'vitest'
import { readAgentProcess, probeAgentProcessPresence } from './agent-process-presence-probe'
import { normalizeHookPayload } from './agent-hook-listener'
import { createHookListenerState } from './agent-hook-listener/listener-state'
import { makePaneKey } from './stable-pane-id'

const run = vi.hoisted(() => vi.fn())
const read = vi.hoisted(() => vi.fn())
vi.mock('@orca/process-host', () => ({ runProcess: run }))
vi.mock('node:fs/promises', () => ({ readFile: read }))
const hostProcess = process
function platform(name: string): void {
  vi.stubGlobal('process', { ...hostProcess, platform: name })
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('platform process evidence', () => {
  it('verifies a WSL Droid capture inside Linux, never on the Windows client', async () => {
    const event = normalizeHookPayload(
      createHookListenerState(),
      'droid',
      {
        paneKey: makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111'),
        env: 'production',
        version: '1',
        agentProcess: { pid: 4242, platform: 'linux', startTime: 'boot-id:100' },
        payload: { hook_event_name: 'UserPromptSubmit', session_id: 'lead', prompt: 'hello' }
      },
      'production'
    )
    expect(event?.agentPresence?.process).toBeDefined()
    platform('linux')
    const fields = ['S', ...Array(18).fill('0'), '100']
    read
      .mockResolvedValueOnce(`4242 (droid) ${fields.join(' ')}`)
      .mockResolvedValueOnce('boot-id\n')
    expect(await probeAgentProcessPresence(event?.agentPresence?.process)).toBe('live')
    read.mockClear()
    platform('win32')
    expect(await probeAgentProcessPresence(event?.agentPresence?.process)).toBe('unverifiable')
    expect(read).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
  it('leaves Windows unanswered until a Windows hook captures an identity', async () => {
    platform('win32')
    expect(await readAgentProcess(4242)).toEqual({ verdict: 'unverifiable' })
    expect(run).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it('treats a missing macOS utility as unanswered', async () => {
    platform('darwin')
    run.mockRejectedValue(Object.assign(new Error('missing ps'), { code: 'ENOENT' }))
    expect(await readAgentProcess(4242)).toEqual({ verdict: 'unverifiable' })
  })

  it('requires Linux process-file absence rather than an unreadable boot identity', async () => {
    platform('linux')
    read.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }))
    expect(await readAgentProcess(4242)).toEqual({ verdict: 'exited' })
    expect(read).toHaveBeenLastCalledWith('/proc/4242/stat', 'utf8')
    const fields = ['S', ...Array(18).fill('0'), '100']
    read
      .mockResolvedValueOnce(`4242 (agent (name)) ${fields.join(' ')}`)
      .mockRejectedValueOnce(new Error('permission denied'))
    expect(await readAgentProcess(4242)).toEqual({ verdict: 'unverifiable' })
    read
      .mockResolvedValueOnce(`4242 (agent (name)) ${fields.join(' ')}`)
      .mockResolvedValueOnce('boot-id\n')
    expect(await readAgentProcess(4242)).toEqual({
      verdict: 'live',
      startTime: 'boot-id:100',
      zombie: false,
      stopped: false
    })
    expect(read).toHaveBeenLastCalledWith('/proc/sys/kernel/random/boot_id', 'utf8')
    read
      .mockResolvedValueOnce(`4242 (agent) ${['T', ...fields.slice(1)].join(' ')}`)
      .mockResolvedValueOnce('boot-id\n')
    expect(await readAgentProcess(4242)).toMatchObject({ verdict: 'live', stopped: true })
  })
})
