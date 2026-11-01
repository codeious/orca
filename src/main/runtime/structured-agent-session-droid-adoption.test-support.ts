// Rigging for tests that adopt a Droid session file into a new chat.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import { resolveStructuredAgentSessionCreateSupport } from '../native-chat/structured-agent-session-create-support'
import { OrcaRuntimeService } from './orca-runtime'
import { structuredAgentRuntimeRegistration } from './structured-agent-runtime-registrations'

export const DROID_SESSION = '5d0f7c2e-3a41-4b8e-9c10-2f6a8e4b7d31'
export const DROID_WORKSPACE = 'workspace-1'
export const DROID_USER_TEXT = 'fix the build'
export const DROID_REPLY_TEXT = 'Looking at the failing step.'
export const DROID_REASONING_TEXT = 'PRIVATE-REASONING-NOT-FOR-THE-CHAT'

export function localLocation(
  overrides: Partial<AgentSessionExecutionLocation> = {}
): AgentSessionExecutionLocation {
  return {
    executionHostId: 'local',
    wslDistro: null,
    workspaceId: DROID_WORKSPACE,
    workspaceKind: 'git-worktree',
    ...overrides
  }
}

/** A runtime whose workspace sits at `location`. Droid's own location rule decides what is
 *  supported; only "is the droid CLI installed" is taken as given. */
export function droidRuntimeAt(location: AgentSessionExecutionLocation): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The runtime reads only the Droid default environment from this store double.
  const runtime = new OrcaRuntimeService({
    getSettings: () => ({ agentDefaultEnv: { droid: {} } })
  } as never)
  vi.spyOn(runtime, 'getStructuredAgentSessionCreateSupport').mockImplementation(async () =>
    resolveStructuredAgentSessionCreateSupport({
      location,
      adapterSupportsCreate:
        structuredAgentRuntimeRegistration('droid')?.supportsLocation(location) ?? false
    })
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This is the runtime's private location seam, replaced so the test chooses where the workspace sits.
  const internal = runtime as unknown as {
    resolveStructuredAgentSessionLocation: () => Promise<AgentSessionExecutionLocation>
  }
  internal.resolveStructuredAgentSessionLocation = vi.fn(async () => location)
  return runtime
}

/**
 * One user turn and one assistant turn that thinks before it answers, filed as Droid does.
 * `messages: false` is a session Droid has created but not yet spoken in: one `session_start` row
 * (`startId` names the id inside it). `content` replaces the whole file.
 */
export async function writeDroidSession(
  home: string,
  options: {
    id?: string
    slug?: string
    folder?: 'sessions' | 'projects'
    messages?: boolean
    startId?: string
    content?: string
  } = {}
): Promise<string> {
  const { id = DROID_SESSION, slug = '-work-app', folder = 'sessions', messages = true } = options
  const directory = join(home, '.factory', folder, slug)
  const path = join(directory, `${id}.jsonl`)
  await mkdir(directory, { recursive: true })
  if (options.content !== undefined) {
    await writeFile(path, options.content, 'utf8')
    return path
  }
  const start = { type: 'session_start', id: options.startId ?? id, cwd: '/work/app' }
  if (!messages) {
    await writeFile(path, `${JSON.stringify(start)}\n`, 'utf8')
    return path
  }
  const records = [
    start,
    {
      type: 'message',
      id: 'u1',
      timestamp: '2026-10-20T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: DROID_USER_TEXT }] }
    },
    {
      type: 'message',
      id: 'a1',
      timestamp: '2026-10-20T10:00:05.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: DROID_REASONING_TEXT },
          { type: 'text', text: DROID_REPLY_TEXT }
        ]
      }
    }
  ]
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8')
  return path
}
