// Scratch probe for ticket "Does a message sent with end_of_turn reach Droid before its agent loop ends?"
// Usage: node probe.mjs models | node probe.mjs run <end_of_turn|end_of_loop> [modelId] [reasoningEffort]
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const [mode, placement, modelId, reasoningEffort] = process.argv.slice(2)
const OUT = '/tmp/droid-steer-probe/out'
mkdirSync(OUT, { recursive: true })
const cwd = mkdtempSync('/tmp/droid-steer-cwd-')
const tag = `${mode}${placement ? `-${placement}` : ''}${modelId ? `.${modelId}` : ''}`
const rawPath = join(OUT, `${tag}.raw.jsonl`)
const errPath = join(OUT, `${tag}.stderr.txt`)
writeFileSync(rawPath, '')
writeFileSync(errPath, '')

const env = { ...process.env, FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false' }
for (const k of Object.keys(env)) {
  if (k.startsWith('ORCA_') || k === 'FACTORY_SESSION_ID' || k === 'FACTORY_UPSTREAM_CLIENT_TYPE') delete env[k]
}

const t0 = Date.now()
const now = () => Date.now() - t0
const log = (dir, frame) => appendFileSync(rawPath, `${JSON.stringify({ t: now(), dir, frame })}\n`)

const child = spawn('droid', ['exec', '--input-format', 'stream-jsonrpc', '--output-format', 'stream-jsonrpc'], {
  cwd,
  env,
  stdio: ['pipe', 'pipe', 'pipe']
})
child.stderr.on('data', (d) => appendFileSync(errPath, d))

let seq = 0
const pending = new Map()
const envelope = { jsonrpc: '2.0', factoryApiVersion: '1.0.0', factoryProtocolVersion: '1.201.1' }
function request(method, params) {
  const id = `r${++seq}`
  const frame = { ...envelope, type: 'request', id, method, params }
  log('out', frame)
  child.stdin.write(`${JSON.stringify(frame)}\n`)
  return new Promise((resolve) => pending.set(id, resolve))
}
function respond(id, result) {
  const frame = { ...envelope, type: 'response', id, result }
  log('out', frame)
  child.stdin.write(`${JSON.stringify(frame)}\n`)
}

const state = { executing: new Set(), steerSent: false, turnsCompleted: 0, lastActivity: now(), idle: false, sessionId: null }
const STEP_CMDS = [1, 2, 3, 4, 5].map((n) => `sleep 4 && echo STEP${n}`)
const PROMPT =
  'Run exactly these 5 shell commands with the Execute tool, one tool call per command, strictly one after another ' +
  '(never in parallel, never combined, wait for each result before starting the next):\n' +
  STEP_CMDS.map((c, i) => `${i + 1}. ${c}`).join('\n') +
  '\nWhen all 5 are done, reply with the single word FINISHED.'
const STEER =
  'STEERMARK-7Q: IMPORTANT change of plan from the user. Do NOT run command 3, 4 or 5. ' +
  'Once the command that is currently running has returned, do not call any more tools; ' +
  'reply with exactly the single word STEERED-7Q and nothing else.'

let onFrameDone
const finished = new Promise((r) => (onFrameDone = r))

function sendSteer(text, extra) {
  state.steerSent = true
  const sentAt = now()
  log('mark', { event: 'steer_send', toolsExecutingSoFar: state.executing.size, placement, ...extra })
  request('droid.add_user_message', { text, queuePlacement: placement }).then((res) => {
    log('mark', { event: 'steer_response', sentAt, ok: !res.error })
  })
}

// "late": one tool, then a long text answer; the steer goes out once that final text starts streaming.
const LATE_PROMPT =
  'Run exactly one shell command with the Execute tool: `sleep 2 && echo ONE`. ' +
  'After it returns, write a numbered list of 40 short, one-sentence facts about the ocean, then stop.'
const LATE_STEER = 'STEERMARK-7Q: after you finish the list, also reply with exactly the single word STEERED-7Q.'
let sawToolResult = false

function handleNotification(n) {
  state.lastActivity = now()
  if (n.type === 'droid_working_state_changed') state.idle = n.newState === 'idle'
  if (n.type === 'agent_turn_completed') state.turnsCompleted += 1
  if (n.type === 'tool_result') sawToolResult = true
  if (mode === 'late' && sawToolResult && n.type === 'assistant_text_delta' && !state.steerSent) {
    sendSteer(LATE_STEER, { scenario: 'late' })
  }
  if (n.type === 'tool_execution_phase_changed' && n.phase === 'executing') {
    state.executing.add(n.toolUseId)
    if ((mode === 'run' || mode === 'interrupt') && state.executing.size === 2 && !state.steerSent) {
      sendSteer(STEER)
      if (mode === 'interrupt') {
        setTimeout(() => {
          log('mark', { event: 'interrupt_send' })
          request('droid.interrupt_session', {}).then((res) => log('mark', { event: 'interrupt_response', ok: !res.error }))
        }, 1500)
      }
    }
  }
}

let buf = ''
child.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    let f
    try {
      f = JSON.parse(line)
    } catch {
      log('in-raw', line)
      continue
    }
    log('in', f)
    if (f.type === 'response' && pending.has(f.id)) {
      pending.get(f.id)(f)
      pending.delete(f.id)
    } else if (f.type === 'request' && f.method === 'droid.request_permission') {
      respond(f.id, { selectedOption: 'proceed_once' })
    } else if (f.type === 'request' && f.method === 'droid.ask_user') {
      respond(f.id, { cancelled: true, answers: [] })
    } else if (f.type === 'notification' && f.method === 'droid.session_notification') {
      handleNotification(f.params?.notification ?? f.params ?? {})
    }
  }
})
child.on('exit', (code) => {
  log('mark', { event: 'exit', code })
  onFrameDone()
})

async function main() {
  const init = await request('droid.initialize_session', {
    machineId: 'probe-machine',
    cwd,
    interactionMode: 'auto',
    autonomyLevel: 'high',
    ...(modelId ? { modelId } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {})
  })
  if (init.error) {
    console.log('initialize error:', JSON.stringify(init.error).slice(0, 400))
    return finish()
  }
  state.sessionId = init.result?.sessionId
  const s = init.result?.settings ?? {}
  console.log('initialized; settings:', JSON.stringify({ modelId: s.modelId, reasoningEffort: s.reasoningEffort, autonomyLevel: s.autonomyLevel, interactionMode: s.interactionMode }))

  if (mode === 'models') {
    const res = await request('droid.list_models', {})
    const rows = res.result?.models ?? []
    for (const m of rows.filter((m) => !m.isCustom)) {
      console.log([m.id, m.displayName, `x${m.tokenMultiplier}`, `eff=${(m.supportedReasoningEfforts ?? []).join('/')}`, `def=${m.defaultReasoningEffort}`].join(' | '))
    }
    return finish()
  }

  const add = await request('droid.add_user_message', { text: mode === 'late' ? LATE_PROMPT : PROMPT })
  // mode "interrupt" reuses the "run" prompt and steer
  log('mark', { event: 'prompt_response', ok: !add.error })
  if (add.error) {
    console.log('add_user_message error:', JSON.stringify(add.error).slice(0, 400))
    return finish()
  }
  const deadline = now() + 240_000
  while (now() < deadline) {
    await new Promise((r) => setTimeout(r, 500))
    if (state.steerSent && state.idle && now() - state.lastActivity > 10_000) break
    if (!state.steerSent && state.idle && state.turnsCompleted > 0 && now() - state.lastActivity > 10_000) break
  }
  log('mark', { event: 'wait_done', timedOut: now() >= deadline, turnsCompleted: state.turnsCompleted })
  return finish()
}

async function finish() {
  await Promise.race([request('droid.close_session', {}), new Promise((r) => setTimeout(r, 5000))])
  child.stdin.end()
  setTimeout(() => child.kill('SIGTERM'), 3000)
  await finished
  console.log(`done; raw log: ${rawPath}; cwd: ${cwd}; session: ${state.sessionId}; toolsExecuted=${state.executing.size}; turnsCompleted=${state.turnsCompleted}`)
}

main()
