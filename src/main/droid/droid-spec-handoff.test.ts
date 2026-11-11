import { afterEach, expect, it, vi } from 'vitest'
import { runDroidRigCleanups, setupDroidAdapter } from './droid-adapter-rig.test-support'

afterEach(runDroidRigCleanups)

it('binds a provider-created plan chat to the committed answer operation', async () => {
  const open = vi.fn(async () => {})
  const h = await setupDroidAdapter({}, undefined, { onSpecHandoff: open })
  const { connection } = await h.start()
  connection.notify({
    type: 'settings_updated',
    settings: { autonomyLevel: 'off', availableAutonomyLevels: ['off'] }
  })
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
        { label: 'New chat', value: 'proceed_new_session' },
        { label: 'Cancel', value: 'cancel' }
      ]
    },
    { id: 'permission', signal: new AbortController().signal }
  )
  const card = (await h.rig.rows()).find(({ body }) => body.kind === 'approval')?.itemId
  if (!card) {
    throw new Error('Approval missing')
  }
  let committed = false
  const accepted = await h.adapter
    .answerPrompt({
      sessionId: h.input.identity.sessionId,
      itemId: card,
      fence: 7,
      kind: 'approval',
      response: { kind: 'option', optionId: 'proceed_new_session' },
      operationId: 'handoff-operation',
      commit: async () => {
        committed = true
      }
    })
    .then(
      () => true,
      () => false
    )
  expect(accepted).toBe(true)
  expect(committed).toBe(true)
  const reply = await answer
  expect(reply).toMatchObject({
    selectedOption: 'proceed_new_session',
    clientStartsHandoffSession: true,
    specHandoffId: expect.any(String)
  })
  if (!reply || typeof reply !== 'object' || !('specHandoffId' in reply)) {
    throw new Error('Missing handoff identity')
  }
  connection.notify({
    type: 'spec_handoff_session_created',
    specHandoffId: reply.specHandoffId,
    newSessionId: 'next-provider-session',
    initialPrompt: 'Implement the plan'
  })
  await vi.waitFor(() =>
    expect(open).toHaveBeenCalledWith('session-timeline', {
      operationId: 'handoff-operation',
      specHandoffId: reply.specHandoffId,
      newSessionId: 'next-provider-session',
      initialPrompt: 'Implement the plan'
    })
  )
})
