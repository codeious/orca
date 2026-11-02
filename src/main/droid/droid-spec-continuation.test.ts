import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRestTestRig,
  type RestTestRig
} from '../native-chat/agent-session-wire/structured-agent-session-rest-test-rig'
import { createTestParams } from '../native-chat/agent-session-wire/structured-agent-session-create-test-fixture'
import { structuredAgentsDeclaringNothing } from '../native-chat/agent-session-wire/structured-agent-session-adapter-router-test-support'
import {
  DROID_ACCOUNT_HOME_VARIABLE,
  DROID_AGENT,
  DROID_HANDLE_TRANSPORT
} from './droid-agent-definition'
import { openDroidSpecContinuation } from './droid-spec-continuation'
import { HOST_TEST_NOW } from '../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import { prepareAdoptedTranscript } from '../native-chat/agent-session-wire/structured-agent-session-adopted-import'

let rig: RestTestRig
const next = 'next-provider-session'
const handoff = {
  operationId: `${HOST_TEST_NOW}-${'f'.repeat(32)}`,
  specHandoffId: 'requested-handoff',
  newSessionId: next,
  initialPrompt: 'Implement the approved plan.',
  autonomyLevel: 'low'
} as const
const sourceId = 'source-chat'
const publish = vi.fn(async () => {})

beforeEach(async () => {
  publish.mockClear()
  rig = await createRestTestRig({
    agents: structuredAgentsDeclaringNothing([DROID_AGENT]),
    idleSweep: { intervalMs: 60_000 }
  })
  rig.adapter.acquire.mockImplementation(async ({ identity, fence, spawnToken }) => {
    if (!identity.providerHandle) {
      throw new Error('The new chat must adopt Droid’s saved session')
    }
    return {
      acquisitionGeneration: 'continuation-generation',
      process: { hostId: 'local', pid: 4242, processStartTimeMs: 1_700_000_000_000, spawnToken },
      link: {
        linkId: 'continuation-link',
        handle: identity.providerHandle,
        origin: 'resumed',
        mintedAtFence: fence,
        observedAt: rig.clock.now
      }
    }
  })
  rig.adapter.dispatch.mockResolvedValue({ state: 'admitted' })
  const source = await rig.host.create(
    { callerKey: 'client' },
    createTestParams(
      undefined,
      {
        provider: 'droid',
        agent: 'droid',
        accountHome: { variable: DROID_ACCOUNT_HOME_VARIABLE, path: rig.root },
        options: { planMode: 'true' }
      },
      sourceId
    )
  )
  expect(source.ok).toBe(true)
})

afterEach(async () => {
  await rig.dispose()
})

function context() {
  return {
    store: rig.store,
    host: () => rig.host,
    deps: { publishContinuationTab: publish, resolveWorkspacePath: async () => rig.root }
  }
}

async function savedSession(cwd = rig.root, id = next) {
  const folder = join(rig.root, 'sessions', 'workspace')
  await mkdir(folder, { recursive: true })
  const path = join(folder, `${next}.jsonl`)
  await writeFile(path, `${JSON.stringify({ type: 'session_start', id, cwd })}\n`)
  return path
}

describe('Droid execution-host plan continuation', () => {
  it('adopts a new empty provider context and persists its first prompt once, without a renderer', async () => {
    const path = await savedSession()
    await Promise.all([
      openDroidSpecContinuation(context(), sourceId, handoff),
      openDroidSpecContinuation(context(), sourceId, handoff)
    ])
    const continuation = rig.store.listRecords().find(({ sessionId }) => sessionId !== sourceId)
    if (!continuation) {
      throw new Error('Continuation missing')
    }
    expect(continuation).toMatchObject({
      provider: 'droid',
      options: { planMode: 'false', autonomyLevel: 'low' },
      providerHandleChain: [
        { origin: 'adopted', handle: { transport: DROID_HANDLE_TRANSPORT, nativeId: next } }
      ]
    })
    const snapshot = await rig.host.journalSnapshot(continuation.sessionId)
    expect(
      snapshot.items.filter(({ body }) => body.kind === 'message').map(({ body }) => body)
    ).toEqual([
      { kind: 'message', role: 'user', blocks: [{ type: 'text', text: handoff.initialPrompt }] }
    ])
    expect(publish).toHaveBeenCalledWith({
      workspaceId: continuation.location.workspaceId,
      sessionId: continuation.sessionId,
      agent: 'droid'
    })
    await rm(path)
    await openDroidSpecContinuation(context(), sourceId, handoff)
    expect(rig.store.listRecords()).toHaveLength(2)
    expect(
      (await rig.host.journalSnapshot(continuation.sessionId)).items.filter(
        ({ body }) => body.kind === 'message'
      )
    ).toHaveLength(1)
    await expect(
      openDroidSpecContinuation(context(), sourceId, { ...handoff, initialPrompt: 'Different' })
    ).rejects.toThrow()
  })

  it.each(['identity', 'folder', 'missing'] as const)(
    'refuses %s mismatch before founding a chat',
    async (kind) => {
      if (kind !== 'missing') {
        await savedSession(
          kind === 'folder' ? join(rig.root, 'another-folder') : rig.root,
          kind === 'identity' ? 'different-provider-session' : next
        )
      }
      await expect(openDroidSpecContinuation(context(), sourceId, handoff)).rejects.toThrow()
      expect(rig.store.listRecords()).toHaveLength(1)
      expect(publish).not.toHaveBeenCalled()
      expect(rig.adapter.acquire).not.toHaveBeenCalled()
    }
  )

  it('still refuses an empty ordinary history adoption', async () => {
    const transcriptPath = await savedSession()
    expect(
      await prepareAdoptedTranscript(
        createTestParams(undefined, {
          provider: 'droid',
          agent: 'droid',
          adopt: {
            transcriptPath,
            providerHandle: { transport: DROID_HANDLE_TRANSPORT, agent: 'droid', nativeId: next },
            source: { providerSessionId: next, workspaceCwd: rig.root, conversationStore: rig.root }
          }
        })
      )
    ).toMatchObject({ ok: false, refusal: { details: { reason: 'transcriptUnreadable' } } })
  })
})
