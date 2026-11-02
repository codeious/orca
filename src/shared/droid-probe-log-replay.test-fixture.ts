// Turns the Droid research probe logs (src/shared/__fixtures__/droid-*-hooks.jsonl) into the hooks
// and process observations a listener and a host see. The logs are not Orca envelopes: ids are
// 8-character prefixes or S1/S2 relations, and a process is the probe's own capture or a relation
// (P1), so this module is where each gets a concrete value. Nothing else is invented, except the
// two things the probe never recorded: the text of a prompt, and a first prompt for a pane (opt-in).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentProcessIdentity } from './agent-process-presence'
import type { AgentProcessObservation } from './agent-process-presence-probe'

export type DroidProbeFixture =
  | 'droid-parent-process-hooks'
  | 'droid-subagent-hooks'
  | 'droid-new-clear-hooks'
  | 'droid-tree-resume-hooks'
  | 'droid-slow-start-hooks'
  | 'droid-two-command-hooks'

export type ReplayHook = {
  type: 'hook'
  /** The log's own words, for failure messages: `SessionEnd S1 other`. */
  label: string
  payload: Record<string, unknown>
  /** The identity the hook command captured; null when the row carries none. */
  process: AgentProcessIdentity | null
  /** Milliseconds on the log's clock, for the logs that have one. */
  atMs: number | null
  /** True for the one prompt the replay adds so a pane has a row. */
  synthetic: boolean
}
export type ReplayProcessObservation = {
  type: 'process'
  stage: string
  pid: number
  observation: AgentProcessObservation
}
export type ReplayStep = ReplayHook | ReplayProcessObservation

export type ReplayRun = {
  name: string
  identity: AgentProcessIdentity
  steps: ReplayStep[]
  /** The session id a log id (`S2`, `8050463b`) stands for in this run. */
  id: (logId: string) => string
}

export const REPLAYED_PROMPT = 'replayed prompt'

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(row: Row, key: string): string | undefined {
  const value = row[key]
  return typeof value === 'string' && value !== '' && value !== 'absent' ? value : undefined
}

function whole(row: Row, key: string): number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/** `S2 (new)` and `S2` name the same session; `absent` names none. */
function relation(value: unknown): string | undefined {
  return typeof value === 'string' && value !== 'absent'
    ? value.replace(/ \(new\)$/, '')
    : undefined
}

function readRows(fixture: DroidProbeFixture): Row[] {
  return readFileSync(join(__dirname, '__fixtures__', `${fixture}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const parsed: unknown = JSON.parse(line)
      if (!isRow(parsed)) {
        throw new Error(`Probe log row is not an object: ${line}`)
      }
      return parsed
    })
}

function capturedIdentity(row: Row): AgentProcessIdentity | undefined {
  const capture = row.orcaCapture
  if (!isRow(capture)) {
    return undefined
  }
  const pid = whole(capture, 'pid')
  const platform = text(capture, 'platform')
  const startTime = text(capture, 'startTime')
  if (pid === undefined || !startTime) {
    return undefined
  }
  return platform === 'darwin' || platform === 'linux' || platform === 'win32'
    ? { pid, platform, startTime }
    : undefined
}

/** The subagent log names its droid by pid and start, and was recorded on macOS. */
function droidIdentity(row: Row): AgentProcessIdentity | undefined {
  const droid = row.droid
  if (!isRow(droid)) {
    return undefined
  }
  const pid = whole(droid, 'pid')
  const startTime = text(droid, 'start')
  return pid !== undefined && startTime ? { pid, platform: 'darwin', startTime } : undefined
}

function observationOf(row: Row): ReplayProcessObservation | undefined {
  const pid = whole(row, 'pid')
  const stage = text(row, 'stage')
  if (pid === undefined || !stage) {
    return undefined
  }
  if (row.alive !== true) {
    return { type: 'process', stage, pid, observation: { verdict: 'exited' } }
  }
  return {
    type: 'process',
    stage,
    pid,
    observation: {
      verdict: 'live',
      startTime: text(row, 'start') ?? '',
      // `ps` shows a process that has exited but is not yet reaped as `<defunct>`.
      zombie: text(row, 'comm') === '<defunct>'
    }
  }
}

function runKey(row: Row): string {
  const pid =
    capturedIdentity(row)?.pid ??
    droidIdentity(row)?.pid ??
    (row.kind === 'hook' ? undefined : whole(row, 'pid'))
  return pid === undefined
    ? `${text(row, 'capture') ?? ''}|${text(row, 'tag') ?? ''}|${relation(row.process) ?? ''}`
    : `pid ${pid}`
}

export type ReplayOptions = {
  /** Adds a `UserPromptSubmit` for the first lead, because the probes never sent a prompt. */
  promptForFirstLead?: boolean
}

export function loadDroidProbeRuns(
  fixture: DroidProbeFixture,
  options: ReplayOptions = {}
): ReplayRun[] {
  const groups = new Map<string, Row[]>()
  for (const row of readRows(fixture)) {
    if (row.kind !== 'hook' && row.kind !== 'tui' && row.kind !== 'droid') {
      continue
    }
    // The first two rows of the session-replacement log are the probe testing itself.
    if (row.tag === 'self-test') {
      continue
    }
    const key = runKey(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.values()].map((rows, index) => buildRun(rows, index, options))
}

function buildRun(rows: Row[], index: number, options: ReplayOptions): ReplayRun {
  const named = rows.find((row) => row.kind === 'hook') ?? rows[0]
  const identity: AgentProcessIdentity = rows
    .map((row) => capturedIdentity(row) ?? droidIdentity(row))
    .find((candidate) => candidate !== undefined) ?? {
    pid: 90_000 + index,
    platform: 'darwin',
    startTime: `replayed process ${index}`
  }
  const prefixed = rows.some((row) => text(row, 'session') !== undefined)
  const id = (logId: string): string => {
    if (prefixed) {
      return `${logId}-0000-4000-8000-000000000000`
    }
    const number = /^S(\d+)$/.exec(logId)?.[1]
    if (!number) {
      throw new Error(`Not a probe relation: ${logId}`)
    }
    return `s${number.padStart(7, '0')}-${String(index).padStart(4, '0')}-4000-8000-000000000000`
  }
  const steps: ReplayStep[] = []
  // A log that already holds a prompt needs none added.
  let prompted = rows.some((row) => text(row, 'event') === 'UserPromptSubmit')
  for (const row of rows) {
    if (row.kind !== 'hook') {
      const observed = observationOf(row)
      if (observed) {
        steps.push(observed)
      }
      continue
    }
    const hook = hookStep(row, identity, id)
    steps.push(hook)
    if (
      options.promptForFirstLead &&
      !prompted &&
      hook.payload.hook_event_name === 'SessionStart'
    ) {
      prompted = true
      if (hook.payload.calling_session_id === undefined) {
        steps.push({
          type: 'hook',
          label: `UserPromptSubmit ${String(hook.payload.session_id)} (replay adds)`,
          payload: {
            hook_event_name: 'UserPromptSubmit',
            session_id: hook.payload.session_id,
            prompt: REPLAYED_PROMPT
          },
          process: hook.process,
          atMs: hook.atMs,
          synthetic: true
        })
      }
    }
  }
  const tag = text(named, 'tag')
  const name = tag && tag !== 'untagged' ? tag : (text(named, 'capture') ?? `run ${index}`)
  return { name, identity, steps, id }
}

function hookStep(
  row: Row,
  identity: AgentProcessIdentity,
  id: (logId: string) => string
): ReplayHook {
  const ids = isRow(row.ids) ? row.ids : undefined
  const session = ids ? relation(ids.session_id) : text(row, 'session')
  const calling = ids ? relation(ids.calling_session_id) : text(row, 'callingSession')
  const previous = ids ? relation(ids.previous_session_id) : undefined
  const event = text(row, 'event') ?? ''
  const source = text(row, 'source')
  const reason = text(row, 'reason')
  const tool = text(row, 'tool_name')
  const milliseconds = whole(row, 'ts')
  const nanoseconds = whole(row, 'arrivalNs')
  return {
    type: 'hook',
    label: [event, session, source, reason].filter(Boolean).join(' '),
    payload: {
      hook_event_name: event,
      ...(session ? { session_id: id(session) } : {}),
      ...(source ? { source } : {}),
      ...(reason ? { reason } : {}),
      ...(calling ? { calling_session_id: id(calling) } : {}),
      ...(previous ? { previous_session_id: id(previous) } : {}),
      ...(tool ? { tool_name: tool, tool_input: {} } : {}),
      ...(event === 'UserPromptSubmit' ? { prompt: REPLAYED_PROMPT } : {})
    },
    process: capturedIdentity(row) ?? droidIdentity(row) ?? identity,
    atMs: milliseconds ?? (nanoseconds === undefined ? null : nanoseconds / 1e6),
    synthetic: false
  }
}

export const hooksOf = (run: ReplayRun): ReplayHook[] =>
  run.steps.filter((step): step is ReplayHook => step.type === 'hook')

/** The `SessionEnd other` hooks that arrive before the SessionStart that replaces their session. */
export function invertedSessionEnds(run: ReplayRun): ReplayHook[] {
  const hooks = hooksOf(run)
  return hooks.filter((hook, index) => {
    const next = hooks[index + 1]?.payload
    return (
      hook.payload.hook_event_name === 'SessionEnd' &&
      hook.payload.reason === 'other' &&
      next?.hook_event_name === 'SessionStart' &&
      next.source === 'resume' &&
      next.session_id !== hook.payload.session_id
    )
  })
}
