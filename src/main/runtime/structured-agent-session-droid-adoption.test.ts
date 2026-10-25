// A Droid history row adopted into a new chat: the host resumes it through Droid's own load and
// shows its history, and refuses everything it cannot read from this machine.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import { DROID_HANDLE_TRANSPORT } from '../droid/droid-agent-definition'
import { agentSessionProviderHandleFromAdopted } from '../native-chat/agent-session-wire/structured-agent-session-adopted-handle'
import type { OrcaRuntimeService } from './orca-runtime'
import {
  DROID_SESSION,
  DROID_WORKSPACE,
  droidRuntimeAt,
  localLocation,
  writeDroidSession
} from './structured-agent-session-droid-adoption.test-support'

let root: string
let home: string

function createIntent(runtime: OrcaRuntimeService, providerSessionId = DROID_SESSION) {
  return runtime.resolveStructuredAgentSessionCreateIntent({
    envelope: { sessionId: 'chat-1', clientOperationId: `${Date.now()}-${'1'.padStart(32, '0')}` },
    worktree: `id:${DROID_WORKSPACE}`,
    agent: 'droid',
    resumeFrom: { providerSessionId }
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-droid-adopt-'))
  home = join(root, 'home')
  await mkdir(home, { recursive: true })
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('adopting a Droid session on create', () => {
  it('seeds the handle chain and names the session file so the chat opens with its history', async () => {
    const file = await writeDroidSession(home)

    const intent = await createIntent(droidRuntimeAt(localLocation()))

    expect(intent).toMatchObject({
      provider: 'droid',
      agent: 'droid',
      accountHome: { path: join(home, '.factory') },
      adopt: { transcriptPath: file }
    })
    expect(agentSessionProviderHandleFromAdopted(intent.adopt!.providerHandle)).toEqual({
      transport: DROID_HANDLE_TRANSPORT,
      agent: 'droid',
      nativeId: DROID_SESSION
    })
  })

  it('finds a session Droid filed under its projects folder, which the vault also lists', async () => {
    const file = await writeDroidSession(home, { folder: 'projects' })

    const intent = await createIntent(droidRuntimeAt(localLocation()))

    expect(intent.adopt?.transcriptPath).toBe(file)
  })

  it('refuses a session with no file on this machine', async () => {
    await expect(createIntent(droidRuntimeAt(localLocation()))).rejects.toMatchObject({
      refusal: {
        code: 'agent_session_identity_required',
        details: { reason: 'transcriptNotFound' }
      }
    })
  })

  it('never reads a file outside the session folders for a hostile id', async () => {
    // Each decoy sits where its id would land if it were joined into the path unchecked.
    await mkdir(join(home, '.factory', 'sessions', '-work-app'), { recursive: true })
    await writeFile(join(home, '.factory', 'secret.jsonl'), '{"type":"message"}\n', 'utf8')
    await writeFile(join(home, 'secret.jsonl'), '{"type":"message"}\n', 'utf8')

    for (const id of ['../../secret', '../../../secret', '..', '.', 'a/b', '']) {
      await expect(createIntent(droidRuntimeAt(localLocation()), id)).rejects.toMatchObject({
        refusal: { code: 'agent_session_identity_required' }
      })
    }
  })

  const OFF_THIS_MACHINE: [string, Partial<AgentSessionExecutionLocation>][] = [
    ['an SSH workspace', { executionHostId: 'ssh:devbox' }],
    ['a WSL workspace', { wslDistro: 'Ubuntu' }]
  ]

  it.each(OFF_THIS_MACHINE)(
    'refuses %s, whose files this machine cannot vouch for',
    async (_name, where) => {
      await writeDroidSession(home)

      await expect(createIntent(droidRuntimeAt(localLocation(where)))).rejects.toMatchObject({
        refusal: {
          code: 'structured_agent_session_unsupported',
          details: { reason: 'hostUnsupported' }
        }
      })
    }
  )
})
