// Scratch harness for ticket "Does a Droid hook command's parent process identify the droid terminal process?"
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = '/tmp/droid-31'
export const OUT = join(ROOT, 'out')
export const PROJ_DIR = join(ROOT, 'proj')
export const BINS = {
  '0.238.0': join(ROOT, 'bin/0.238.0/droid'),
  '0.244.0': process.env.DROID_BIN || 'droid',
  'linux-0.238.0': join(ROOT, 'bin-linux/0.238.0/droid'),
  'linux-0.244.0': join(ROOT, 'bin-linux/0.244.0/droid')
}
export const homeFor = (label) => join(ROOT, `home-${label}`)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function cleanEnv(label, extra = {}) {
  const env = {
    ...process.env,
    HOME: homeFor(label),
    FACTORY_DISABLE_KEYRING: '1',
    FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false',
    ORCA_PANE_KEY: 'probe-pane',
    PROBE_OUT: OUT,
    ...extra
  }
  for (const k of Object.keys(env)) {
    if ((k.startsWith('ORCA_') && k !== 'ORCA_PANE_KEY') || k === 'FACTORY_SESSION_ID' || k === 'FACTORY_UPSTREAM_CLIENT_TYPE') delete env[k]
  }
  if (!('FACTORY_API_KEY' in extra)) delete env.FACTORY_API_KEY
  return env
}

// The droid pid as the OS reports it from outside (same time zone and format as Orca's Darwin capture).
export function readIdentity(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const rest = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')
      const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
      return { pid, start: `${boot}:${rest[19]}`, ppid: rest[1], comm: readFileSync(`/proc/${pid}/comm`, 'utf8').trim() }
    } catch {
      return { pid, start: '', ppid: '', comm: '' }
    }
  }
  const ps = (field) => {
    try {
      return execFileSync('/bin/ps', ['-p', String(pid), '-o', `${field}=`], { env: { ...process.env, TZ: 'UTC0', LC_ALL: 'C' }, encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
  const comm = ps('comm')
  return { pid, start: ps('lstart'), ppid: ps('ppid'), comm: comm.split('/').pop() }
}

export function mark(label, stage, pid) {
  const ident = readIdentity(pid)
  appendFileSync(join(OUT, 'hooks.jsonl'), `${JSON.stringify({ kind: 'droid', tag: label, stage, ...ident, alive: ident.start !== '' })}\n`)
  return { ...ident, alive: ident.start !== '' }
}

export function startDroid({ label, bin, tag, args = ['exec', '--input-format', 'stream-jsonrpc', '--output-format', 'stream-jsonrpc'], env, cwd = PROJ_DIR }) {
  mkdirSync(OUT, { recursive: true })
  const child = spawn(bin, args, { cwd, env: { ...env, PROBE_TAG: tag }, stdio: ['pipe', 'pipe', 'pipe'] })
  const stderr = []
  child.stderr.on('data', (d) => stderr.push(String(d)))
  let seq = 0
  const pending = new Map()
  const envelope = { jsonrpc: '2.0', factoryApiVersion: '1.0.0', factoryProtocolVersion: '1.201.1' }
  const write = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`)
  const request = (method, params) => {
    const id = `r${++seq}`
    write({ ...envelope, type: 'request', id, method, params })
    return new Promise((resolve) => pending.set(id, resolve))
  }
  const exited = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })))
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      let f
      try { f = JSON.parse(line) } catch { continue }
      if (f.type === 'response' && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id) }
    }
  })
  const close = async () => {
    await Promise.race([request('droid.close_session', {}), sleep(5000)])
    child.stdin.end()
    setTimeout(() => child.kill('SIGTERM'), 3000)
    return exited
  }
  return { child, request, close, exited, stderr }
}
