// Credit-free: initialize a structured session in a throwaway HOME, no prompt, and look at what lands on disk.
import { mkdirSync } from 'node:fs'
import { HOME_DIR, PROJ_DIR, snap, startDroid, sleep, maskIds } from './lib.mjs'

mkdirSync(HOME_DIR, { recursive: true })
mkdirSync(PROJ_DIR, { recursive: true })
snap('before start')

const d = startDroid({ tag: 'step1' })
const init = await d.request('droid.initialize_session', { machineId: 'probe-machine', cwd: PROJ_DIR, interactionMode: 'auto', autonomyLevel: 'off' })
console.log('initialize error:', init.error ? JSON.stringify(init.error).slice(0, 300) : 'none')
console.log('initialize result keys:', Object.keys(init.result ?? {}))
console.log('sessionId present:', Boolean(init.result?.sessionId), 'shape:', maskIds(init.result?.sessionId ?? ''))
await sleep(1500)
snap('after initialize_session (no prompt)')
const exit = await d.close()
await sleep(500)
snap('after close_session')
console.log('exit:', JSON.stringify(exit))
console.log('stderr (masked, first 400):', maskIds(d.stderr.join('')).slice(0, 400))
