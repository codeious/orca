// Real-CLI check that a signed-out Droid chat reaches model_authentication_failed on its first
// prompt, journals the not-signed-in failure, and resumes in a fresh process. Skipped unless opted in:
//   ORCA_REAL_DROID_CLI_TEST=1 pnpm test src/main/droid/droid-session-real-cli.test.ts
// Everything runs under a throwaway HOME with no credentials, so no model call is made and no
// credits are spent; the machine's ~/.factory is never read or written.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcessSync } from '@orca/process-host'
import type { AgentSessionProviderHandleLink } from '../../shared/agent-session-provider-handle'
import type { AgentJournalMessageItem } from '../../shared/agent-session-journal-types'
import {
  closeProviderTimelineRigs,
  openProviderTimelineRig
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { stopAgentSessionProviderRoot } from '../native-chat/agent-session-wire/structured-agent-session-provider-exit-proof'
import { resolveRealDroidCliGate } from './droid-real-cli-test-gate'
import { resolveDroidCommand } from './droid-launch-resolution'
import { DroidSessionAdapter } from './droid-session-adapter'

const gate = resolveRealDroidCliGate(process.env, process.platform, (args) => {
  try {
    return { status: runProcessSync({ program: 'droid', args, timeoutMs: 10_000 }).code }
  } catch {
    return { status: null }
  }
})

const sessionId = 'real-cli-session'
const prompt: AgentJournalMessageItem = {
  kind: 'message',
  role: 'user',
  blocks: [{ type: 'text', text: 'say hi' }]
}

/** The machine's environment minus every way Droid could find a login: an API key, a Factory
 *  override, or an XDG directory that moves its config. */
function signedOutEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/^(ORCA_|FACTORY_|XDG_)/.test(key)) {
      env[key] = value
    }
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    FACTORY_DISABLE_KEYRING: '1',
    FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false'
  }
}

describe.skipIf(gate.skipReason !== null)('A signed-out Droid chat (real CLI)', () => {
  let root: string
  let adapters: DroidSessionAdapter[]

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-droid-real-cli-session-'))
    mkdirSync(join(root, 'home'))
    mkdirSync(join(root, 'project'))
    mkdirSync(join(root, 'elsewhere'))
    adapters = []
  })

  afterEach(async () => {
    for (const adapter of adapters) {
      await adapter.closeAll().catch(() => {})
      await adapter.drainObservedExits()
      adapter.acknowledgeSessionRelease(sessionId)
    }
    await closeProviderTimelineRigs()
    rmSync(root, { recursive: true, force: true })
  })

  async function openChat() {
    const env = signedOutEnv(join(root, 'home'))
    const rig = await openProviderTimelineRig({ agent: 'droid', sessionId })
    const start = async (
      fence: number,
      previous: AgentSessionProviderHandleLink | null,
      folder = 'project'
    ): Promise<{ adapter: DroidSessionAdapter; link: AgentSessionProviderHandleLink }> => {
      const adapter = new DroidSessionAdapter({
        resolveLaunch: async () => ({
          command: resolveDroidCommand(env),
          cwd: join(root, folder),
          env,
          previous,
          autonomyLevel: 'off'
        }),
        onLifecycle: vi.fn(),
        onSettled: vi.fn(),
        onIdle: vi.fn(),
        logger: { warn: vi.fn(), error: vi.fn() }
      })
      adapters.push(adapter)
      const input: StructuredAgentSessionAcquireInput = {
        identity: {
          sessionId,
          workspaceId: 'folder-1',
          hostId: 'local',
          agent: 'droid',
          providerHandle: null
        },
        fence,
        spawnToken: `real-cli-spawn-token-${fence}`,
        events: rig.eventSink,
        onSpawned: vi.fn(async () => {})
      }
      const acquired = await adapter.acquire(input)
      return { adapter, link: acquired.link }
    }
    const notSignedInFailures = async () =>
      (await rig.rows()).flatMap(({ body }) =>
        body.kind === 'status' && body.failure?.kind === 'notSignedIn' ? [body.failure] : []
      )
    return { rig, start, notSignedInFailures }
  }

  it('journals notSignedIn when the first prompt ends in model_authentication_failed', async () => {
    const chat = await openChat()
    // A signed-out initialize still succeeds; only the prompt is refused.
    const { adapter } = await chat.start(1, null)

    const outcome = await adapter.dispatch({
      sessionId,
      clientMessageId: 'send-1',
      body: prompt,
      fence: 1
    })

    expect(outcome).toEqual({ state: 'admitted' })
    await vi.waitFor(async () => expect(await chat.notSignedInFailures()).toHaveLength(1), {
      timeout: 30_000,
      interval: 250
    })
    expect((await chat.rig.turns())[0]).toMatchObject({ state: 'completed', outcome: 'failure' })
  }, 60_000)

  it('resumes the same session in a fresh process through load_session', async () => {
    const chat = await openChat()
    const first = await chat.start(1, null)
    await first.adapter.dispatch({
      sessionId,
      clientMessageId: 'send-1',
      body: prompt,
      fence: 1
    })
    await vi.waitFor(async () => expect(await chat.notSignedInFailures()).toHaveLength(1), {
      timeout: 30_000,
      interval: 250
    })
    // A root-only close never observes descendants, so the host reads this error as the root gone.
    await stopAgentSessionProviderRoot(() => first.adapter.closeSession(sessionId))
    await first.adapter.drainObservedExits()
    first.adapter.acknowledgeSessionRelease(sessionId)

    const resumed = await chat.start(2, first.link)

    expect(resumed.link).toMatchObject({
      origin: 'resumed',
      handle: { nativeId: first.link.handle.nativeId }
    })
  }, 90_000)

  it('refuses to load a session from a workspace other than the folder it was recorded in', async () => {
    const chat = await openChat()
    const first = await chat.start(1, null)
    await stopAgentSessionProviderRoot(() => first.adapter.closeSession(sessionId))
    await first.adapter.drainObservedExits()
    first.adapter.acknowledgeSessionRelease(sessionId)

    // Droid loads from any folder and reports the one it was recorded in, so only the comparison stops it.
    await expect(chat.start(2, first.link, 'elsewhere')).rejects.toThrow(/folder/)
  }, 90_000)
})
