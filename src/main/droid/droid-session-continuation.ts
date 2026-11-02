import { randomUUID } from 'node:crypto'
import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { readStartedSession } from './droid-started-session'
import { droidProviderLink } from './droid-structured-launch-resolution'
import type { DroidSession, DroidSessionDeps } from './droid-session'
import type { DroidStartSettings } from './droid-session-settings'

export async function continueDroidSession(
  session: Pick<DroidSession, 'request' | 'close' | 'droidSessionId' | 'settings' | 'model'>,
  context: {
    input: StructuredAgentSessionAcquireInput
    begin: DroidStartSettings & { cwd: string }
    deps: DroidSessionDeps
    generation: string
  },
  id: string
): Promise<void> {
  const { input, begin, deps, generation } = context
  try {
    const result = await session.request(
      'droid.load_session',
      { sessionId: id },
      { timeoutMs: 120_000 }
    )
    const started = await readStartedSession(result, {
      id,
      cwd: begin.cwd,
      realpath: deps.realpath
    })
    session.droidSessionId = started.id
    session.settings.adopt(started.settings)
    deps.onLifecycle({
      type: 'options-reported',
      sessionId: input.identity.sessionId,
      fence: input.fence,
      acquisitionGeneration: generation,
      reportedOptions: {
        ...session.model.current,
        planMode: (session.settings.current.interactionMode ?? begin.interactionMode) === 'spec'
      },
      link: {
        ...droidProviderLink({ previous: null }, id, input.fence, randomUUID(), Date.now()),
        origin: 'forked'
      }
    })
  } catch (error) {
    await session.close()
    throw error
  }
}
