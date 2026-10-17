// Scratch harness for ticket "Does a structured Droid session share its session id and transcript with a terminal Droid session?"
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export const ROOT = '/tmp/droid-28'
export const HOME_DIR = join(ROOT, 'home')
export const PROJ_DIR = join(ROOT, 'proj-a')

export function cleanEnv(extra = {}) {
  const env = { ...process.env, HOME: HOME_DIR, FACTORY_DISABLE_KEYRING: '1', FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false', ...extra }
  for (const k of Object.keys(env)) {
    if (k.startsWith('ORCA_') || k === 'FACTORY_SESSION_ID' || k === 'FACTORY_UPSTREAM_CLIENT_TYPE') delete env[k]
  }
  if (!('FACTORY_API_KEY' in extra)) delete env.FACTORY_API_KEY
  return env
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

// File tree under HOME/.factory with ids masked, so only shapes are reported.
export function snap(label) {
  const out = []
  const walk = (dir) => {
    let names = []
    try { names = readdirSync(dir) } catch { return }
    for (const n of names.sort()) {
      const p = join(dir, n)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else out.push(`${relative(HOME_DIR, p).replace(UUID, '<uuid>')}  ${st.size}B`)
    }
  }
  walk(join(HOME_DIR, '.factory'))
  console.log(`--- tree (${label}) ---\n${out.join('\n') || '(empty)'}`)
}

export function startDroid({ tag, args = ['exec', '--input-format', 'stream-jsonrpc', '--output-format', 'stream-jsonrpc'], env = cleanEnv(), cwd = PROJ_DIR, onNotification, onRequest }) {
  mkdirSync(join(ROOT, 'out'), { recursive: true })
  const rawPath = join(ROOT, 'out', `${tag}.raw.jsonl`)
  writeFileSync(rawPath, '')
  const t0 = Date.now()
  const now = () => Date.now() - t0
  const log = (dir, frame) => appendFileSync(rawPath, `${JSON.stringify({ t: now(), dir, frame })}\n`)
  const child = spawn('droid', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  const stderr = []
  child.stderr.on('data', (d) => stderr.push(String(d)))
  let seq = 0
  const pending = new Map()
  const envelope = { jsonrpc: '2.0', factoryApiVersion: '1.0.0', factoryProtocolVersion: '1.201.1' }
  const write = (frame) => { log('out', frame); child.stdin.write(`${JSON.stringify(frame)}\n`) }
  const request = (method, params) => {
    const id = `r${++seq}`
    write({ ...envelope, type: 'request', id, method, params })
    return new Promise((resolve) => pending.set(id, resolve))
  }
  const respond = (id, result) => write({ ...envelope, type: 'response', id, result })
  const exited = new Promise((resolve) => child.on('exit', (code, sig) => { log('mark', { event: 'exit', code, sig }); resolve({ code, sig }) }))
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      if (!line.trim()) continue
      let f
      try { f = JSON.parse(line) } catch { log('in-raw', line); continue }
      log('in', f)
      if (f.type === 'response' && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id) }
      else if (f.type === 'request') onRequest?.(f, respond)
      else if (f.type === 'notification' && f.method === 'droid.session_notification') onNotification?.(f.params?.notification ?? f.params ?? {}, now())
    }
  })
  const close = async () => {
    await Promise.race([request('droid.close_session', {}), new Promise((r) => setTimeout(r, 5000))])
    child.stdin.end()
    setTimeout(() => child.kill('SIGTERM'), 3000)
    return exited
  }
  return { child, request, respond, close, exited, stderr, rawPath, now, log }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const maskIds = (s) => String(s).replace(UUID, '<uuid>')
