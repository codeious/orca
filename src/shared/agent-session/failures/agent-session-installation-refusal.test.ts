import { expect, it } from 'vitest'
import { agentSessionFailureSentence } from './agent-session-failure-words'
import { readAgentSessionRefusalReference } from './agent-session-wire-refusals'
import { agentCliInstallationFacts } from '../../agent-cli-installation-problem'
import {
  agentSessionRefusalCauseParts,
  agentSessionWriteNoticeEnglish
} from './agent-session-refusal-notice'
import { agentSessionRefusalFailure } from './agent-session-write-failure'

it.each(['agent_session_operation_invalid', 'structured_agent_session_unsupported'] as const)(
  'retains version facts through a serialized %s refusal and words the failure',
  (code) => {
    const installation = {
      agent: 'codex',
      installedVersion: '0.1.0',
      minimumVersion: '0.136.0'
    } as const
    const refusal = readAgentSessionRefusalReference(
      JSON.parse(
        JSON.stringify({
          code,
          details: {
            reason:
              code === 'structured_agent_session_unsupported' ? 'hostUnsupported' : 'attachFailed',
            ...agentCliInstallationFacts(installation)
          }
        })
      )
    )
    expect(refusal?.details).toMatchObject({
      agentInstallation: installation,
      codexInstallation: { installedVersion: '0.1.0', minimumVersion: '0.136.0' }
    })
    const sentence = agentSessionFailureSentence({ kind: 'startFailed', refusal }, 'row')
    expect(sentence).toContain('Codex 0.1.0 is too old for chats.')
    expect(sentence).toContain('0.136.0')
    expect(refusal).toBeDefined()
    const cause = agentSessionWriteNoticeEnglish(
      agentSessionRefusalCauseParts(agentSessionRefusalFailure(refusal!))
    )
    expect(cause).toBe('Codex 0.1.0 is too old for chats. Update to 0.136.0 or newer.')
  }
)
