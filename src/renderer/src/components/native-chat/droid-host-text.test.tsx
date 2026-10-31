// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n/i18n'
import en from '@/i18n/locales/en.json'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import {
  AgentJournalItemBodySchema,
  isAdmissibleAgentJournalItemBody
} from '../../../../shared/agent-session-journal-schemas'
import type { AgentJournalStatusItem } from '../../../../shared/agent-session-journal-types'
import { DROID_HOST_COPY } from '../../../../shared/droid-host-copy'
import { structuredAgentSessionStatusBlock } from '../../../../shared/structured-agent-session-status-block'
import { agentSessionWriteFailureText } from './agent-session-write-notice-text'
import { droidCommandFailureWords } from './droid-child-command-words'
import { NativeChatNoticeRow } from './NativeChatNoticeRow'

const PREFIX = 'components.native-chat.droidHost.'
const PARAMS = {
  removedCount: 7,
  folder: '/workspace',
  target: '/outside',
  skillName: 'review',
  serverName: 'docs',
  value: 'invalid'
}

afterEach(() => {
  cleanup()
  i18n.addResourceBundle('en', 'translation', en, true, true)
})

function failure(textKey?: string, textParams = PARAMS) {
  return new RuntimeRpcCallError({
    id: 'host-copy-test',
    ok: false,
    error: {
      code: 'runtime_error',
      message: 'English from an older host.',
      data: textKey ? { textKey, textParams } : {}
    }
  })
}

describe('Droid host copy reaches the reader through en.json', () => {
  it('replays compression prose below the catalog label as assistant markdown', () => {
    const textKey = `${PREFIX}compressMany`
    i18n.addResource('en', 'translation', textKey, 'Catalog compression label.')
    const replayed: unknown = AgentJournalItemBodySchema.parse(
      JSON.parse(
        JSON.stringify({
          kind: 'status',
          text: 'Older host fallback.',
          textKey,
          textParams: { removedCount: 7 },
          summaryText:
            '## Remembered context\n\nThe user asked for **ok**.\n\nThe assistant replied ok.'
        })
      )
    )
    if (!isAdmissibleAgentJournalItemBody(replayed) || replayed.kind !== 'status') {
      throw new Error('Expected a status row')
    }
    render(<NativeChatNoticeRow block={structuredAgentSessionStatusBlock(replayed)} />)
    expect(screen.getByText('Catalog compression label.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Remembered context' })).toBeInTheDocument()
    expect(screen.getByText('ok', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('The assistant replied ok.')).toBeInTheDocument()
  })

  it('keeps every host fallback word-for-word equal to the English catalog', () => {
    expect(en.components['native-chat'].droidHost).toEqual(DROID_HOST_COPY)
  })

  it.each(Object.entries(en.components['native-chat'].droidHost))(
    'resolves %s and its parameters from a key, including after journal replay',
    (key, template) => {
      const textKey = `${PREFIX}${key}`
      // A different catalog value proves this is not the host's English fallback.
      i18n.addResource('en', 'translation', textKey, `Catalog: ${template}`)
      const expected = `Catalog: ${template}`.replace(
        /\{\{(\w+)\}\}/g,
        (match, name: string) =>
          Object.entries(PARAMS)
            .find(([param]) => param === name)?.[1]
            ?.toString() ?? match
      )
      expect(droidCommandFailureWords(failure(textKey), 'context', false)).toBe(expected)
      const row: AgentJournalStatusItem = {
        kind: 'status',
        text: 'Old journal English.',
        textKey,
        textParams: PARAMS
      }
      const replayed: unknown = AgentJournalItemBodySchema.parse(JSON.parse(JSON.stringify(row)))
      if (!isAdmissibleAgentJournalItemBody(replayed) || replayed.kind !== 'status') {
        throw new Error('Expected a status row')
      }
      render(<NativeChatNoticeRow block={structuredAgentSessionStatusBlock(replayed)} />)
      expect(screen.getByText(expected)).toBeInTheDocument()
    }
  )

  it.each([undefined, `${PREFIX}unknownFutureSentence`])(
    'keeps old host and unknown key English unchanged (%s)',
    (textKey) => {
      expect(droidCommandFailureWords(failure(textKey), 'context', false)).toBe(
        'English from an older host.'
      )
      render(<NativeChatNoticeRow block={{ type: 'text', text: 'Older journal row.', textKey }} />)
      expect(screen.getByText('Older journal row.')).toBeInTheDocument()
    }
  )

  it('uses the keyed host sentence in an autonomy refusal without changing other provider text', () => {
    const textKey = `${PREFIX}newerAutonomy`
    i18n.addResource('en', 'translation', textKey, 'Keyed autonomy refusal.')
    const refusal = {
      kind: 'refused' as const,
      code: 'agent_session_operation_invalid' as const,
      details: { reason: 'providerRefusedOption' as const, textKey }
    }
    expect(agentSessionWriteFailureText(refusal, 'option', 'Host fallback.')).toContain(
      'Keyed autonomy refusal.'
    )
    expect(
      agentSessionWriteFailureText(
        { ...refusal, details: { reason: 'providerRefusedOption' } },
        'option',
        'Claude refused this model.'
      )
    ).toContain('Claude refused this model.')
  })
})
