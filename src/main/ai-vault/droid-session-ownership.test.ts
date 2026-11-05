import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { agentSessionConversationView } from '../../shared/agent-session/lifecycle/agent-session-conversation-view'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import {
  installOwnership,
  listResult,
  PROVIDER_SESSION
} from './structured-session-ownership.test-support'
import {
  assertLegacyAiVaultResumeAllowed,
  assertLegacyAiVaultResumeCommandAllowed,
  projectStructuredAiVaultSessions,
  OPENS_EVERY_STRUCTURED_CHAT
} from './structured-session-ownership'

beforeEach(() =>
  installOwnership({
    handle: { transport: 'droid-stream-jsonrpc', agent: 'droid', nativeId: PROVIDER_SESSION },
    accountHome: { variable: 'ORCA_DROID_ACCOUNT_HOME', path: '/profile/.factory' }
  })
)
afterEach(() => setStructuredAgentSessionHost(null))

describe('chat-owned Droid conversation', () => {
  it('allows prepared and typed resumes after proven exit while history keeps the owner', async () => {
    installOwnership({
      handle: { transport: 'droid-stream-jsonrpc', agent: 'droid', nativeId: PROVIDER_SESSION },
      ownerObservation: agentSessionConversationView(
        agentSessionRecordFixture(
          agentSessionLeaseFixture({
            claimStatus: 'released',
            ownerProcess: null,
            reservedSpawnToken: null,
            deathEvidence: { kind: 'exit-observed', detail: 'exited', observedAt: 3_000 }
          })
        )
      ).ownerObservation
    })
    expect(() =>
      assertLegacyAiVaultResumeAllowed({
        agent: 'droid',
        sessionId: PROVIDER_SESSION,
        filePath: '',
        codexHome: null,
        executionHostId: 'local'
      })
    ).not.toThrow()
    await expect(
      assertLegacyAiVaultResumeCommandAllowed(`droid --resume ${PROVIDER_SESSION}`, async () => {})
    ).resolves.toBeUndefined()
    const listed = listResult()
    listed.sessions[0]!.agent = 'droid'
    expect(
      projectStructuredAiVaultSessions(listed, OPENS_EVERY_STRUCTURED_CHAT).sessions[0]
        ?.structuredSession?.sessionId
    ).toBe('session-alpha')
  })
  it('opens its owning chat and refuses legacy terminal resume, but permits a fork', () => {
    const listed = listResult()
    listed.sessions[0]!.agent = 'droid'
    expect(
      projectStructuredAiVaultSessions(listed, OPENS_EVERY_STRUCTURED_CHAT).sessions[0]
    ).toMatchObject({ structuredSession: { sessionId: 'session-alpha' } })
    const resume = {
      agent: 'droid',
      executionHostId: 'local',
      sessionId: PROVIDER_SESSION,
      filePath: `/profile/.factory/sessions/folder/${PROVIDER_SESSION}.jsonl`,
      codexHome: null
    } as const
    expect(() => assertLegacyAiVaultResumeAllowed(resume)).toThrow('agent_session_conflict')
    expect(() => assertLegacyAiVaultResumeAllowed({ ...resume, fork: true })).not.toThrow()
  })

  it.each([
    `droid --resume '${PROVIDER_SESSION}'`,
    `env SETTING=value "/bin with spaces/droid" resume "${PROVIDER_SESSION}"`,
    `echo 'safe'; droid exec --session-id=${PROVIDER_SESSION}`,
    `droid --last`
  ])('guards the real program in a shell command: %s', async (command) => {
    await expect(assertLegacyAiVaultResumeCommandAllowed(command, async () => {})).rejects.toThrow(
      'agent_session_conflict'
    )
  })

  it.each([
    `echo "droid --resume ${PROVIDER_SESSION}"`,
    `droid --fork '${PROVIDER_SESSION}'`,
    `droid resume '${PROVIDER_SESSION}' --fork`,
    `droid --resume a-different-conversation`,
    'droid exec -r high "Work on this"'
  ])('does not block prompts, forks or another session: %s', async (command) => {
    await expect(
      assertLegacyAiVaultResumeCommandAllowed(command, async () => {})
    ).resolves.toBeUndefined()
  })
})
