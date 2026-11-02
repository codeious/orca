import { afterEach, describe, expect, it, vi } from 'vitest'
import { DroidSpecHandoffs } from './droid-spec-handoff'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter
} from './droid-adapter-rig.test-support'

afterEach(runDroidRigCleanups)

describe('host-owned Droid Spec handoff', () => {
  it('names one handoff per operation and invokes the host once for duplicate notifications', async () => {
    const open = vi.fn(async () => {})
    const handoffs = new DroidSpecHandoffs('source', open)
    const id = handoffs.begin('proceed_new_session_low', 'operation')
    expect(handoffs.begin('proceed_new_session_low', 'operation')).toBe(id)
    expect(
      new DroidSpecHandoffs('source', open).begin('proceed_new_session_low', 'operation')
    ).toBe(id)
    expect(() => handoffs.begin('proceed_new_session_high', 'operation')).toThrow(/already used/)
    const notification = {
      type: 'spec_handoff_session_created',
      specHandoffId: id,
      newSessionId: 'new-provider-session',
      initialPrompt: 'Implement the plan.'
    } as const
    const first = handoffs.created(notification)
    expect(await handoffs.created(notification)).toEqual([])
    expect(await first).toMatchObject([
      { body: { kind: 'status', text: 'Plan continued in a new chat.' } }
    ])
    expect(open).toHaveBeenCalledExactlyOnceWith({
      operationId: 'operation',
      specHandoffId: id,
      newSessionId: notification.newSessionId,
      initialPrompt: notification.initialPrompt,
      autonomyLevel: 'low'
    })
    expect(await handoffs.created({ ...notification, specHandoffId: 'unsolicited' })).toEqual([])
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('commits the answer before asking Droid to hand the plan to the execution host', async () => {
    const open = vi.fn(async () => {})
    const h = await setupDroidAdapter({}, undefined, { onSpecHandoff: open })
    const { connection } = await h.start()
    const answer = connection.handlers.onRequest?.(
      'droid.request_permission',
      {
        toolUses: [
          {
            toolUse: { name: 'ExitSpecMode', input: {} },
            confirmationType: 'exit_spec_mode',
            details: { plan: 'A plan', supportsClientStartedHandoff: true }
          }
        ],
        options: [
          { label: 'New chat', value: 'proceed_new_session_low' },
          { label: 'Cancel', value: 'cancel' }
        ]
      },
      { id: 'permission', signal: new AbortController().signal }
    )
    let card: string | undefined
    await vi.waitFor(async () => {
      card = (await h.rig.rows()).find(({ body }) => body.kind === 'approval')?.itemId
      expect(card).toBeDefined()
    })
    if (!card) {
      throw new Error('Approval missing')
    }
    const commit = vi.fn(async () => {
      expect(open).not.toHaveBeenCalled()
    })
    await h.adapter.answerPrompt({
      sessionId: DROID_RIG_SESSION,
      itemId: card,
      fence: 7,
      kind: 'approval',
      response: { kind: 'option', optionId: 'proceed_new_session_low' },
      operationId: 'host-operation',
      commit
    })
    const id = new DroidSpecHandoffs(DROID_RIG_SESSION, open).begin(
      'proceed_new_session_low',
      'host-operation'
    )
    await expect(answer).resolves.toEqual({
      selectedOption: 'proceed_new_session_low',
      clientStartsHandoffSession: true,
      specHandoffId: id
    })
    connection.notify({
      type: 'spec_handoff_session_created',
      specHandoffId: id,
      newSessionId: 'next',
      initialPrompt: 'Go'
    })
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
