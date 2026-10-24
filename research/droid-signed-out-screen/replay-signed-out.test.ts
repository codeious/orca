// Research probe, not a regression test: replays each signed-out droid recording at its recorded read
// times through the real runtime, status store and automation observer, and prints what they decide.
// Run from the repo root after copying this file to src/main/runtime/ (vitest only globs src/**).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTranscriptPane, TRANSCRIPT_PANE_PTY_ID } from './agent-transcript-pane-test-harness'
import { makeAgentStatusStoreWiring } from './agent-status-store-wiring.test-fixture'
import { RuntimeMachineName } from './runtime-machine-name'
import { createRuntimeAutomationRunTerminalObserver } from '../automations/runtime-terminal-run-observer'
import type { AutomationRun } from '../../shared/automations-types'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

const REPLAY_DIR = join(process.cwd(), 'research', 'droid-signed-out-screen', 'replay')
const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'
// 130 s is past AGENT_START_GRACE_MS (2 min), so a "success after the grace" verdict has time to land.
// 6 h 10 min is past the observer's own OBSERVE_DEADLINE_MS, so its give-up verdict has time to land.
const SHORT_HORIZON_MS = 130_000
const LONG_HORIZON_MS = (6 * 60 + 10) * 60_000

const CASES = [
  ['0-249-0', 'bare', SHORT_HORIZON_MS],
  ['0-249-0', 'prompt', SHORT_HORIZON_MS],
  ['0-249-0', 'auto-prompt', SHORT_HORIZON_MS],
  ['0-249-0', 'badkey-bare', SHORT_HORIZON_MS],
  ['0-249-0', 'badkey-prompt', SHORT_HORIZON_MS],
  ['0-238-0', 'bare', SHORT_HORIZON_MS],
  ['0-238-0', 'prompt', SHORT_HORIZON_MS],
  ['0-238-0', 'badkey-bare', SHORT_HORIZON_MS],
  ['0-238-0', 'badkey-prompt', SHORT_HORIZON_MS],
  ['0-249-0', 'bare', LONG_HORIZON_MS],
  ['0-249-0', 'badkey-bare', LONG_HORIZON_MS],
  ['0-238-0', 'bare', LONG_HORIZON_MS]
] as const

function readTimedFixture(name: string): { chunks: string[]; times: number[] } {
  const data = readFileSync(join(REPLAY_DIR, `${name}.txt`), 'utf8')
  const timing: { chunks: [number, number][] } = JSON.parse(
    readFileSync(join(REPLAY_DIR, `${name}.timing.json`), 'utf8')
  )
  const chunks: string[] = []
  let offset = 0
  for (const [, length] of timing.chunks) {
    chunks.push(data.slice(offset, offset + length))
    offset += length
  }
  expect(offset).toBe(data.length)
  return { chunks, times: timing.chunks.map(([at]) => at) }
}

describe('signed-out droid replayed through the automation observer', () => {
  let machineNameStartSpy: { mockRestore(): void } | undefined
  beforeEach(() => {
    machineNameStartSpy = vi
      .spyOn(RuntimeMachineName.prototype, 'start')
      .mockImplementation(() => {})
  })
  afterEach(() => {
    machineNameStartSpy?.mockRestore()
    vi.useRealTimers()
  })

  const results: Record<string, unknown>[] = []

  it.each(CASES)(
    'droid %s %s observed for %i ms',
    async (version, mode, horizonMs) => {
      const name = `droid-${version}-signed-out-${mode}-120x40`
      const { chunks, times } = readTimedFixture(name)
      const wiring = makeAgentStatusStoreWiring()
      const options = {
        paneTitle: 'Terminal',
        foregroundProcess: 'droid' as string | null,
        launchAgent: 'droid' as const,
        data: '',
        size: { cols: 120, rows: 40 }
      }
      const { runtime, handle } = await createTranscriptPane(options, wiring.deps)
      vi.useFakeTimers({
        toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
      })
      const t0 = Date.now()
      const waits: { at: number; satisfied: boolean; blockedReason?: string }[] = []
      const timeouts: { at: number; message: string }[] = []
      const host = {
        getTerminalHandleForPaneKey: (paneKey: string) =>
          runtime.getTerminalHandleForPaneKey(paneKey),
        readTerminal: (terminal: string, opts?: { limit?: number }) =>
          runtime.readTerminal(terminal, opts),
        waitForTerminal: async (
          terminal: string,
          opts?: { condition?: 'tui-idle'; timeoutMs?: number; signal?: AbortSignal }
        ) => {
          try {
            const wait = await runtime.waitForTerminal(terminal, opts)
            waits.push({
              at: Date.now() - t0,
              satisfied: wait.satisfied,
              ...(wait.blockedReason ? { blockedReason: wait.blockedReason } : {})
            })
            return wait
          } catch (error) {
            // The end-of-horizon abort also rejects; only the runtime's own timeout is a re-arm.
            if (error instanceof Error && error.message === 'timeout') {
              timeouts.push({ at: Date.now() - t0, message: error.message })
            }
            throw error
          }
        }
      }
      const observer = createRuntimeAutomationRunTerminalObserver(host, {
        getAgentStatusRowsForPane: (paneKey) => runtime.getAgentStatusRowsForPane(paneKey),
        agentCommandsForRun: () => ['droid']
      })
      const abort = new AbortController()
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the observer reads only these fields.
      const run = {
        id: 'run-1',
        automationId: 'automation-1',
        terminalPaneKey: PANE_KEY,
        startedAt: t0,
        dispatchedAt: t0
      } as AutomationRun
      let verdict: { status: string; error: string | null } | null = null
      let verdictAt: number | null = null
      void observer.observeCompletion(handle, { signal: abort.signal, run }).then(
        (observation) => {
          verdict = { status: observation.status, error: observation.error }
          verdictAt = Date.now() - t0
        },
        () => {}
      )

      let exitedAt: number | null = null
      for (const [index, chunk] of chunks.entries()) {
        await vi.advanceTimersByTimeAsync(Math.max(0, t0 + times[index] - Date.now()))
        runtime.onPtyData(TRANSCRIPT_PANE_PTY_ID, chunk, Date.now())
        if (exitedAt === null && chunk.includes('Authentication failed')) {
          // droid has left the foreground: the shell takes the PTY back.
          options.foregroundProcess = 'bash'
          exitedAt = Date.now() - t0
        }
      }
      const lastReadAt = Date.now() - t0
      await vi.advanceTimersByTimeAsync(Math.max(0, horizonMs - (Date.now() - t0)))
      abort.abort()

      const tail = (await runtime.readTerminal(handle, { limit: 12 })).tail
      const rows = wiring.deps.getAgentProviderSessionRowsForPane(PANE_KEY)
      results.push({
        name,
        observedForMs: horizonMs,
        lastReadAtMs: lastReadAt,
        droidLeftForegroundAtMs: exitedAt,
        firstSatisfiedTuiIdleAtMs: waits.find((wait) => wait.satisfied)?.at ?? null,
        tuiIdleWaits: waits.slice(0, 6),
        tuiIdleTimeouts: { count: timeouts.length, firstAtMs: timeouts[0]?.at ?? null },
        agentStatusRows: rows.length,
        observerVerdict: verdict,
        observerVerdictAtMs: verdictAt,
        tail: tail.filter((line) => line.trim().length > 0).slice(-6)
      })
    },
    600_000
  )

  it('writes the results', () => {
    const out = join(REPLAY_DIR, '..', 'replay-results.json')
    writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`)
    expect(results.length).toBe(CASES.length)
  })
})
