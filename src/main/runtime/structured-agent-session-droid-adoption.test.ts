// A Droid history row adopted into a new chat: the host resumes it through Droid's own load and
// shows its history, and refuses everything it cannot read from this machine.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import { DROID_HANDLE_TRANSPORT } from '../droid/droid-agent-definition'
import { agentSessionProviderHandleFromAdopted } from '../native-chat/agent-session-wire/structured-agent-session-adopted-handle'
import { resolveStructuredAgentSessionCreateSupport } from '../native-chat/structured-agent-session-create-support'
import { OrcaRuntimeService } from './orca-runtime'
import { structuredAgentRuntimeRegistration } from './structured-agent-runtime-registrations'

const SESSION = '5d0f7c2e-3a41-4b8e-9c10-2f6a8e4b7d31'
const WORKSPACE = 'workspace-1'

let root: string
let home: string

type Location = AgentSessionExecutionLocation

function localLocation(overrides: Partial<Location> = {}): Location {
  return {
    executionHostId: 'local',
    wslDistro: null,
    workspaceId: WORKSPACE,
    workspaceKind: 'git-worktree',
    ...overrides
  }
}

function runtimeAt(location: Location): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService({
    getSettings: () => ({ agentDefaultEnv: { droid: {} } })
  } as never)
  // Droid's real location rule decides; only "is the droid CLI installed" is taken as given.
  vi.spyOn(runtime, 'getStructuredAgentSessionCreateSupport').mockImplementation(async () =>
    resolveStructuredAgentSessionCreateSupport({
      location,
      adapterSupportsCreate:
        structuredAgentRuntimeRegistration('droid')?.supportsLocation(location) ?? false
    })
  )
  const internal = runtime as unknown as {
    resolveStructuredAgentSessionLocation: () => Promise<Location>
  }
  internal.resolveStructuredAgentSessionLocation = vi.fn(async () => location)
  return runtime
}

function createIntent(runtime: OrcaRuntimeService, providerSessionId = SESSION) {
  return runtime.resolveStructuredAgentSessionCreateIntent({
    envelope: { sessionId: 'chat-1', clientOperationId: `${Date.now()}-${'1'.padStart(32, '0')}` },
    worktree: `id:${WORKSPACE}`,
    agent: 'droid',
    resumeFrom: { providerSessionId }
  })
}

async function writeDroidSession(
  id = SESSION,
  slug = '-work-app',
  folder: 'sessions' | 'projects' = 'sessions'
): Promise<string> {
  const path = join(home, '.factory', folder, slug, `${id}.jsonl`)
  await mkdir(join(home, '.factory', folder, slug), { recursive: true })
  await writeFile(
    path,
    `${JSON.stringify({ type: 'session_start', id, cwd: '/work/app' })}\n${JSON.stringify({
      type: 'message',
      id: 'u1',
      timestamp: '2026-10-20T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'fix the build' }] }
    })}\n`,
    'utf8'
  )
  return path
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
    const file = await writeDroidSession()

    const intent = await createIntent(runtimeAt(localLocation()))

    expect(intent).toMatchObject({
      provider: 'droid',
      agent: 'droid',
      accountHome: { path: join(home, '.factory') },
      adopt: { transcriptPath: file }
    })
    expect(agentSessionProviderHandleFromAdopted(intent.adopt!.providerHandle)).toEqual({
      transport: DROID_HANDLE_TRANSPORT,
      agent: 'droid',
      nativeId: SESSION
    })
  })

  it('finds a session Droid filed under its projects folder, which the vault also lists', async () => {
    const file = await writeDroidSession(SESSION, '-work-app', 'projects')

    const intent = await createIntent(runtimeAt(localLocation()))

    expect(intent.adopt?.transcriptPath).toBe(file)
  })

  it('refuses a session with no file on this machine', async () => {
    await expect(createIntent(runtimeAt(localLocation()))).rejects.toMatchObject({
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
      await expect(createIntent(runtimeAt(localLocation()), id)).rejects.toMatchObject({
        refusal: { code: 'agent_session_identity_required' }
      })
    }
  })

  const OFF_THIS_MACHINE: [string, Partial<Location>][] = [
    ['an SSH workspace', { executionHostId: 'ssh:devbox' }],
    ['a WSL workspace', { wslDistro: 'Ubuntu' }]
  ]

  it.each(OFF_THIS_MACHINE)(
    'refuses %s, whose files this machine cannot vouch for',
    async (_name, where) => {
      await writeDroidSession()

      await expect(createIntent(runtimeAt(localLocation(where)))).rejects.toMatchObject({
        refusal: {
          code: 'structured_agent_session_unsupported',
          details: { reason: 'hostUnsupported' }
        }
      })
    }
  )
})
