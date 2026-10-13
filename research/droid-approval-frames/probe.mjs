// Scratch probe for ticket "What do Droid's approval, block, and settings frames look like in a live session?"
// Usage: [OVERLAY=<settings file>] [INIT_LEVEL=<level>] node probe.mjs <scenario> [modelId] [reasoningEffort]
// Free scenarios (no prompt is sent): settings | cap (OVERLAY=overlay-cap.json) | model | allowed (CANDIDATES=id,id)
// Paid scenarios (modelId required, pinned before any prompt): off | high-rules | legacy-block (OVERLAY=overlay-legacy.json) | spec-off | spec-high
// high-rules uses overlay-settings.json unless OVERLAY is set. Raw logs go to /tmp/droid-approval-probe/out (not for git).
// Permission answers are limited to proceed_once or cancel; an "always" option is never chosen.
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const [scenario, modelId, reasoningEffort] = process.argv.slice(2)
const OUT = '/tmp/droid-approval-probe/out'
mkdirSync(OUT, { recursive: true })
const cwd = mkdtempSync('/tmp/droid-approval-cwd-')
const tag = `${scenario}${modelId ? `.${modelId}` : ''}`
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Project rules need workspace trust (user setting, off limits), so the rules ride a process-only overlay.
const overlay = join(OUT, `overlay-${scenario}.json`)
const overlaySource = process.env.OVERLAY ?? (scenario === 'high-rules' ? '/tmp/droid-approval-probe/overlay-settings.json' : null)
const useOverlay = overlaySource !== null
if (useOverlay) copyFileSync(overlaySource, overlay)
const args = ['exec', ...(useOverlay ? ['--settings', overlay] : []), '--input-format', 'stream-jsonrpc', '--output-format', 'stream-jsonrpc']
const child = spawn('droid', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
child.stderr.on('data', (d) => appendFileSync(errPath, d))

let seq = 0
const pending = new Map()
const envelope = { jsonrpc: '2.0', factoryApiVersion: '1.0.0', factoryProtocolVersion: '1.201.1' }
function send(frame) {
  log('out', frame)
  child.stdin.write(`${JSON.stringify(frame)}\n`)
}
function request(method, params) {
  const id = `r${++seq}`
  send({ ...envelope, type: 'request', id, method, params })
  return new Promise((resolve) => pending.set(id, resolve))
}
function respond(id, result) {
  send({ ...envelope, type: 'response', id, result })
}

const state = { idle: false, turnsCompleted: 0, lastActivity: now(), permissionRequests: 0 }
// Which option to pick per confirmation type; anything else is cancelled.
const ANSWER = { exec: 'proceed_once', apply_patch: 'proceed_once', edit: 'proceed_once', create: 'proceed_once', exit_spec_mode: 'cancel' }

function handleNotification(n) {
  state.lastActivity = now()
  if (n.type === 'settings_updated') state.settings = n.settings
  if (n.type === 'droid_working_state_changed') state.idle = n.newState === 'idle'
  if (n.type === 'agent_turn_completed') state.turnsCompleted += 1
}

let buf = ''
let finishedResolve
const finished = new Promise((r) => (finishedResolve = r))
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
      state.permissionRequests += 1
      const types = (f.params?.toolUses ?? []).map((t) => t.confirmationType)
      const values = (f.params?.options ?? []).map((o) => o.value)
      const pick = ANSWER[types[0]] ?? 'cancel'
      const chosen = values.includes(pick) ? pick : 'cancel'
      log('mark', { event: 'permission_answer', types, offered: values, chosen })
      respond(f.id, { selectedOption: chosen })
    } else if (f.type === 'request' && f.method === 'droid.ask_user') {
      log('mark', { event: 'ask_user_cancel' })
      respond(f.id, { cancelled: true, answers: [] })
    } else if (f.type === 'notification' && f.method === 'droid.session_notification') {
      handleNotification(f.params?.notification ?? f.params ?? {})
    }
  }
})
child.on('exit', (code) => {
  log('mark', { event: 'exit', code })
  finishedResolve()
})

async function init(autonomyLevel, interactionMode = 'auto') {
  const res = await request('droid.initialize_session', {
    machineId: 'probe-machine',
    cwd,
    interactionMode,
    autonomyLevel,
    ...(modelId ? { modelId } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {})
  })
  if (res.error) {
    console.log('initialize error:', JSON.stringify(res.error).slice(0, 400))
    return null
  }
  const s = res.result?.settings ?? {}
  console.log('initialized; settings:', JSON.stringify({ modelId: s.modelId, reasoningEffort: s.reasoningEffort, autonomyLevel: s.autonomyLevel, interactionMode: s.interactionMode, availableAutonomyLevels: s.availableAutonomyLevels }))
  state.settings = s
  return res.result
}

// initialize_session did not apply modelId on 0.240.0; pin it and refuse to prompt on any other model.
async function pinModel() {
  if (!modelId) {
    console.log('paid scenarios need a model id; refusing to prompt on the default model')
    return false
  }
  if (state.settings?.modelId !== modelId || (reasoningEffort && state.settings?.reasoningEffort !== reasoningEffort)) {
    await updateSettings('pin model', { modelId, ...(reasoningEffort ? { reasoningEffort } : {}) })
  }
  const ok = state.settings?.modelId === modelId && (!reasoningEffort || state.settings?.reasoningEffort === reasoningEffort)
  log('mark', { event: 'pin_model', ok, modelId: state.settings?.modelId, reasoningEffort: state.settings?.reasoningEffort })
  console.log(`pinned model: ${ok ? 'yes' : 'NO'} (${state.settings?.modelId}, ${state.settings?.reasoningEffort})`)
  return ok
}

// Send one prompt and wait until its turn is done and Droid is idle.
async function turn(label, text, timeoutMs = 120_000) {
  log('mark', { event: 'turn_start', label })
  const before = state.turnsCompleted
  const add = await request('droid.add_user_message', { text })
  if (add.error) {
    console.log(`${label}: add_user_message error`, JSON.stringify(add.error).slice(0, 300))
    return
  }
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    await sleep(500)
    if (state.turnsCompleted > before && state.idle && now() - state.lastActivity > 4000) break
  }
  log('mark', { event: 'turn_done', label, timedOut: now() >= deadline })
}

async function updateSettings(label, params) {
  log('mark', { event: 'update_settings', label, params })
  const res = await request('droid.update_session_settings', params)
  log('mark', { event: 'update_settings_response', label, ok: !res.error, error: res.error })
  await sleep(1500)
}

const ECHO_PROMPT = (cmd) =>
  `Use the Execute tool to run exactly this shell command once, with no changes: ${cmd}\nThen reply with the single word DONE.`

async function main() {
  if (scenario === 'settings') {
    // Free: no model prompt is sent.
    const r = await init('off')
    if (!r) return finish()
    for (const level of ['low', 'medium', 'high', 'off']) await updateSettings(`autonomy=${level}`, { autonomyLevel: level })
    await updateSettings('autonomy=ultra (invalid)', { autonomyLevel: 'ultra' })
    await updateSettings('empty params', {})
    await updateSettings('interactionMode=spec', { interactionMode: 'spec' })
    await updateSettings('interactionMode=auto', { interactionMode: 'auto' })
    return finish()
  }
  if (scenario === 'cap') {
    // Free: an overlay that sets maxAutonomyLevel; see what initialize and update do with a level above it.
    const r = await init(process.env.INIT_LEVEL ?? 'high')
    if (!r) return finish()
    for (const level of ['high', 'medium', 'low', 'off', 'high']) await updateSettings(`autonomy=${level}`, { autonomyLevel: level })
    return finish()
  }
  if (scenario === 'legacy-block') {
    if (!(await init('high')) || !(await pinModel())) return finish()
    await turn('exec-legacy-block', ECHO_PROMPT('echo LEGACYBLOCK'))
    await turn('exec-legacy-denylist', ECHO_PROMPT('echo LEGACYASK'))
    return finish()
  }
  if (scenario === 'allowed') {
    // Free: update_session_settings with a model sends no prompt, and an org-blocked model is rejected.
    if (!(await init('off'))) return finish()
    const list = await request('droid.list_models', {})
    const byId = new Map((list.result?.models ?? []).map((m) => [m.id, m]))
    const candidates = (process.env.CANDIDATES ?? '').split(',').filter(Boolean)
    for (const id of candidates) {
      const res = await request('droid.update_session_settings', { modelId: id, ...(reasoningEffort ? { reasoningEffort } : {}) })
      const m = byId.get(id)
      await sleep(300)
      console.log(`${res.error ? 'BLOCKED' : 'allowed'} ${id} -> now ${state.settings?.modelId} eff=${state.settings?.reasoningEffort}${res.error ? ` :: ${res.error.message.slice(0, 60)}` : ''}${m ? ` x${m.tokenMultiplier}` : ''}`)
    }
    return finish()
  }
  if (scenario === 'model') {
    // Free: checks only that the requested model can be pinned.
    if (!(await init('off'))) return finish()
    await pinModel()
    return finish()
  }
  if (scenario === 'off') {
    if (!(await init('off')) || !(await pinModel())) return finish()
    await turn('exec', ECHO_PROMPT('echo hello-probe'))
    await turn('create-file', 'Use your file tools to create a new file named probe.txt in the current directory containing the single line hello. Then reply DONE.')
    await turn('edit-file', 'Use your file editing tool to change the line in probe.txt from hello to goodbye. Then reply DONE.')
    return finish()
  }
  if (scenario === 'high-rules') {
    if (!(await init('high')) || !(await pinModel())) return finish()
    await turn('exec-no-rule', ECHO_PROMPT('echo hello-probe'))
    await turn('exec-ask-rule', ECHO_PROMPT('echo ASKME'))
    await turn('exec-block-rule', ECHO_PROMPT('echo BLOCKME'))
    await turn('create-file-high', 'Use your file tools to create a new file named probe.txt in the current directory containing the single line hello. Then reply DONE.')
    return finish()
  }
  if (scenario === 'spec-off' || scenario === 'spec-high') {
    const level = scenario === 'spec-off' ? 'off' : 'high'
    if (!(await init(level, 'spec')) || !(await pinModel())) return finish()
    // Spec mode runs on specModeModelId, which defaults to the user's own (costlier) pick; pin it for this session only.
    await updateSettings('pin spec model', { specModeModelId: modelId, specModeReasoningEffort: reasoningEffort })
    const sm = state.settings
    const specOk = sm?.specModeModelId === modelId && sm?.specModeReasoningEffort === reasoningEffort && sm?.interactionMode === 'spec'
    log('mark', { event: 'pin_spec_model', ok: specOk, specModeModelId: sm?.specModeModelId, specModeReasoningEffort: sm?.specModeReasoningEffort, interactionMode: sm?.interactionMode })
    console.log(`pinned spec model: ${specOk ? 'yes' : 'NO'} (${sm?.specModeModelId}, ${sm?.specModeReasoningEffort}, mode ${sm?.interactionMode})`)
    if (!specOk) return finish()
    await turn('spec-plan', 'Plan how to add a file named notes.txt containing the word hello to this directory. Keep the plan to two bullet points, then present it for approval.')
    return finish()
  }
  console.log('unknown scenario')
  return finish()
}

async function finish() {
  await Promise.race([request('droid.close_session', {}), sleep(5000)])
  child.stdin.end()
  setTimeout(() => child.kill('SIGTERM'), 3000)
  await finished
  console.log(`done; raw log: ${rawPath}; cwd: ${cwd}; turnsCompleted=${state.turnsCompleted}; permissionRequests=${state.permissionRequests}`)
}

main()
