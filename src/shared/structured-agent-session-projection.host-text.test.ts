import { describe, expect, it } from 'vitest'
import {
  AgentJournalRenderItemSchema,
  isAdmissibleAgentJournalRenderItem
} from './agent-session-journal-schemas'
import { projectStructuredItemToNativeChat } from './structured-agent-session-projection'

function projectStatus(metadata: Record<string, unknown>) {
  const raw = {
    itemId: 'status-1',
    revision: 1,
    sequence: 1,
    observedAt: 1,
    body: { kind: 'status', text: 'Setting refused.', ...metadata }
  }
  const parsed: unknown = AgentJournalRenderItemSchema.parse(JSON.parse(JSON.stringify(raw)))
  if (!isAdmissibleAgentJournalRenderItem(parsed)) {
    throw new Error('Expected admissible status')
  }
  return projectStructuredItemToNativeChat(parsed)?.blocks[0]
}

describe('journal status host text transport', () => {
  it('preserves optional metadata through schema admission and native chat projection', () => {
    expect(
      projectStatus({
        textKey: 'future.host.settingRefused',
        textParams: { model: 'custom-model', count: 2 },
        hostOnly: 'must not reach the chat'
      })
    ).toEqual({
      type: 'text',
      text: 'Setting refused.',
      textKey: 'future.host.settingRefused',
      textParams: { model: 'custom-model', count: 2 }
    })
  })

  it('keeps older and malformed metadata rows readable with the original text fallback', () => {
    for (const metadata of [
      {},
      { textKey: null, textParams: [] },
      { textKey: 3, textParams: { count: 1 } },
      { textParams: { count: 1 } },
      { textKey: '' },
      { textKey: 'k'.repeat(257) }
    ]) {
      expect(projectStatus(metadata)).toEqual({ type: 'text', text: 'Setting refused.' })
    }
    expect(
      projectStatus({
        textKey: 'future.host.settingRefused',
        textParams: { model: 'custom-model', nested: { ignored: true }, bool: true }
      })
    ).toEqual({
      type: 'text',
      text: 'Setting refused.',
      textKey: 'future.host.settingRefused',
      textParams: { model: 'custom-model' }
    })
    expect(
      projectStatus({
        textKey: 'future.host.settingRefused',
        textParams: []
      })
    ).toEqual({
      type: 'text',
      text: 'Setting refused.',
      textKey: 'future.host.settingRefused'
    })
  })
})
