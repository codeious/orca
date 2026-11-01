// A submission the client asked to wait for the running reply (`afterReply`) keeps that on its
// journal row, so a handover that runs after a restart still waits.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AgentJournalMessageItem,
  AgentSessionJournalIdentity
} from '../../../shared/agent-session-journal-types'
import { createJournalReducerState, applyJournalRow } from './journal-reducer'
import { parseJournalRow, serializeJournalRow, type JournalRow } from './journal-row-schema'
import type { AgentSessionJournal } from './journal-store'
import { createTrackedJournalOpener } from './journal-host-database-test-support'
import {
  agentSessionJournalProviderHandle,
  claudeProviderHandle
} from '../../../shared/agent-session-provider-handle-encoding'

const IDENTITY: AgentSessionJournalIdentity = {
  sessionId: 'session-w',
  workspaceId: 'ws-1',
  hostId: 'host-1',
  agent: 'claude',
  providerHandle: claudeProviderHandle('native-1', null)
}
const BODY: AgentJournalMessageItem = {
  kind: 'message',
  role: 'user',
  blocks: [{ type: 'text', text: 'then answer this' }]
}

let root: string
let clock = 1_000
const journals = createTrackedJournalOpener()

function open(): Promise<AgentSessionJournal> {
  return journals.open({
    identity: IDENTITY,
    stateDirectory: root,
    now: () => ++clock,
    mintEpoch: () => `epoch-${clock}`
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-after-reply-'))
  clock = 1_000
})

afterEach(async () => {
  await journals.closeAll()
  await rm(root, { recursive: true, force: true })
})

describe('the submission keeps the request to wait for the reply', () => {
  it('on that send only, across a reload', async () => {
    let journal = await open()
    await journal.appendSubmission({
      clientMessageId: 'wait-1',
      payloadFingerprint: 'fp',
      body: BODY,
      fence: 0,
      afterReply: true
    })
    await journal.appendSubmission({
      clientMessageId: 'plain-1',
      payloadFingerprint: 'fp',
      body: BODY,
      fence: 0
    })
    await journal.close()
    journal = await open()
    expect(journal.submission('wait-1')).toMatchObject({ afterReply: true })
    expect(journal.submission('plain-1')).not.toHaveProperty('afterReply')
  })
})

describe('the persisted row', () => {
  const row: JournalRow = {
    v: 1,
    kind: 'submission',
    epoch: 'epoch-1',
    seq: 1,
    fence: 0,
    ts: 1,
    clientMessageId: 'wait-1',
    payloadFingerprint: 'fp',
    providerHandle: agentSessionJournalProviderHandle(IDENTITY),
    body: BODY,
    afterReply: true
  }

  it('parses with the key, which a reader that does not know it simply keeps', () => {
    expect(parseJournalRow(serializeJournalRow(row))).toMatchObject({
      ok: true,
      row: { afterReply: true }
    })
  })

  it('keeps a row whose stored request is malformed, reading it as an ordinary send', () => {
    const parsed = parseJournalRow(JSON.stringify({ ...row, afterReply: 'yes' }))
    if (!parsed.ok) {
      throw new Error('the row must survive a malformed request')
    }
    const state = createJournalReducerState('session-w', 'epoch-1')
    applyJournalRow(state, parsed.row)
    expect(state.submissions.get('wait-1')).not.toHaveProperty('afterReply')
  })
})
