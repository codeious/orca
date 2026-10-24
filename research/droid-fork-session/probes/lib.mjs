// Harness for "Does droid.fork_session leave the process on the fork, and does droid exec --fork work over stream-jsonrpc without a prompt?"
// Env: PROBE_ROOT (scratch dir, default /tmp/droid-fork-session-probe), PROBE_BIN_DIR (<dir>/<version>/droid, default $PROBE_ROOT/bin),
// KEY_FILE (a file with a FACTORY_API_KEY= line; only read for key mode "real").
import { spawn } from 'node:child_process'
import {
  appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export const ROOT = process.env.PROBE_ROOT ?? '/tmp/droid-fork-session-probe'
export const BIN_DIR = process.env.PROBE_BIN_DIR ?? join(ROOT, 'bin')
export const BAD_KEY = 'fk-made-up-for-fork-probe-0000'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The real key lives in this module's memory and in the child's environment, nowhere else.
let realKey = null
function readRealKey() {
  if (realKey) return realKey
  const file = process.env.KEY_FILE
  if (!file) throw new Error('set KEY_FILE for key mode "real"')
  const text = readFileSync(file, 'utf8')
  const line = text.split(/\r?\n/).find((l) => /^\s*(export\s+)?FACTORY_API_KEY\s*=/.test(l))
  const value = (line ? line.replace(/^\s*(export\s+)?FACTORY_API_KEY\s*=\s*/, '') : text.split(/\r?\n/)[0]).trim().replace(/^["']|["']$/g, '')
  if (!value) throw new Error('no key in KEY_FILE')
  realKey = value
  return realKey
}
export const redact = (s) => (realKey ? String(s).split(realKey).join('<key>') : String(s))

export function keyFor(mode) {
  return mode === 'real' ? readRealKey() : BAD_KEY
}

export function cleanEnv(home, mode) {
  const env = { ...process.env, HOME: home, FACTORY_DISABLE_KEYRING: '1', FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false', FACTORY_API_KEY: keyFor(mode) }
  for (const k of Object.keys(env)) {
    if (k.startsWith('ORCA_') || k === 'FACTORY_SESSION_ID' || k === 'FACTORY_UPSTREAM_CLIENT_TYPE') delete env[k]
  }
  return env
}

export function droidBin(version) {
  const bin = join(BIN_DIR, version, 'droid')
  if (!existsSync(bin)) throw new Error(`missing ${bin}`)
  return bin
}

// A fresh throwaway HOME plus two real folders: a (where sessions are recorded) and b (a different workspace).
export function sandbox(tag) {
  const base = join(ROOT, 'run', tag)
  rmSync(base, { recursive: true, force: true })
  for (const d of ['home', 'a', 'b', 'out']) mkdirSync(join(base, d), { recursive: true })
  const real = realpathSync(base)
  return { tag, base: real, home: join(real, 'home'), a: join(real, 'a'), b: join(real, 'b'), out: join(real, 'out'), missing: join(real, 'does-not-exist') }
}

// Stable labels for ids so a report shows relations (S = original, F = fork) and never the ids themselves.
export function makeMasker(sb) {
  const labels = new Map()
  const counters = {}
  const name = (id, prefix) => {
    if (!labels.has(id)) {
      counters[prefix] = (counters[prefix] ?? 0) + 1
      labels.set(id, `<${prefix}${counters[prefix]}>`)
    }
    return labels.get(id)
  }
  const mask = (s) =>
    redact(s)
      .split(sb.base).join('<root>')
      .replace(UUID, (u) => labels.get(u.toLowerCase()) ?? labels.get(u) ?? name(u, 'id'))
      .replace(/\/(private\/)?tmp\/[^\s"',)]*droid-fork-session-probe/g, '<scratch>')
  return { name, mask, labels }
}

// Session files under HOME, keyed by id.
export function listSessions(sb) {
  const found = new Map()
  for (const root of ['sessions', 'projects']) {
    const top = join(sb.home, '.factory', root)
    if (!existsSync(top)) continue
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (entry.name.endsWith('.jsonl')) {
          const raw = readFileSync(p, 'utf8')
          const records = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
          found.set(entry.name.replace(/\.jsonl$/, ''), {
            file: p,
            slug: dir === top ? '' : dir.slice(top.length + 1),
            sha: createHash('sha256').update(raw).digest('hex').slice(0, 12),
            settingsSha: existsSync(p.replace(/\.jsonl$/, '.settings.json'))
              ? createHash('sha256').update(readFileSync(p.replace(/\.jsonl$/, '.settings.json'))).digest('hex').slice(0, 12)
              : null,
            records
          })
        }
      }
    }
    walk(top)
  }
  return found
}

export function startDroid(sb, { tag, version, args = ['exec', '--input-format', 'stream-jsonrpc', '--output-format', 'stream-jsonrpc'], mode = 'bad', cwd, mask, onNotification }) {
  const rawPath = join(sb.out, `${tag}.raw.jsonl`)
  writeFileSync(rawPath, '')
  const t0 = Date.now()
  const log = (dir, frame) => appendFileSync(rawPath, `${mask(JSON.stringify({ t: Date.now() - t0, dir, frame }))}\n`)
  const child = spawn(droidBin(version), args, { cwd: cwd ?? sb.a, env: cleanEnv(sb.home, mode), stdio: ['pipe', 'pipe', 'pipe'] })
  const stderr = []
  const frames = []
  child.stderr.on('data', (d) => stderr.push(String(d)))
  let seq = 0
  const pending = new Map()
  const envelope = { jsonrpc: '2.0', factoryApiVersion: '1.0.0', factoryProtocolVersion: '1.201.1' }
  const write = (frame) => { log('out', frame); child.stdin.write(`${JSON.stringify(frame)}\n`) }
  let exitInfo = null
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => { exitInfo = { code, signal, atMs: Date.now() - t0 }; log('mark', { event: 'exit', code, signal }); resolve(exitInfo) }))
  const request = (method, params, timeoutMs = 20000) => {
    const id = `r${++seq}`
    write({ ...envelope, type: 'request', id, method, params })
    return Promise.race([
      new Promise((resolve) => pending.set(id, resolve)),
      new Promise((resolve) => setTimeout(() => resolve({ error: { code: 'probe-timeout', message: `no response in ${timeoutMs} ms` } }), timeoutMs))
    ])
  }
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      if (!line.trim()) continue
      let f
      try { f = JSON.parse(line) } catch { log('in-raw', line); frames.push({ kind: 'raw' }); continue }
      log('in', f)
      frames.push({ kind: f.type, method: f.method, notification: f.params?.notification?.type })
      if (f.type === 'response' && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id) }
      else if (f.type === 'notification' && f.method === 'droid.session_notification') onNotification?.({ ...(f.params?.notification ?? {}), sessionId: f.params?.sessionId })
    }
  })
  const close = async () => {
    if (exitInfo) return exitInfo
    await Promise.race([request('droid.close_session', {}, 5000), sleep(5000)])
    child.stdin.end()
    setTimeout(() => child.kill('SIGTERM'), 3000)
    setTimeout(() => child.kill('SIGKILL'), 8000)
    return exited
  }
  return { child, request, close, exited, stderr, frames, rawPath, isExited: () => exitInfo, exitInfo: () => exitInfo }
}

export async function waitFor(pred, ms = 15000, step = 200) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (pred()) return true
    await sleep(step)
  }
  return pred()
}

// One-line shape of a transcript record. Message and parent ids are labelled so copies are visible across sessions.
export function summarize(record, midLabel) {
  const bits = [record.type]
  if (record.seq !== undefined) bits.push(`seq=${record.seq}`)
  if (record.id && record.type === 'message') bits.push(`id=${midLabel(record.id)}`)
  if (record.parentId) bits.push(`parent=${midLabel(record.parentId)}`)
  if (record.type === 'message') bits.push(`${record.message?.role}${record.message?.visibility ? `/${record.message.visibility}` : ''}`)
  if (record.type === 'agent_turn_outcome') bits.push(`reason=${record.reason}`)
  return bits.join(' ')
}

export function writeResult(sb, name, data, mask) {
  const dir = join(ROOT, 'results')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}.json`)
  writeFileSync(path, `${mask(JSON.stringify(data, null, 2))}\n`)
  return path
}
