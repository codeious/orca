import { afterEach, describe, expect, it } from 'vitest'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter
} from './droid-adapter-rig.test-support'
import { DroidRpcError } from './droid-rpc-errors'

afterEach(runDroidRigCleanups)

// The injected connection has no child process or network transport. Never run this method live.
describe('Droid /bug on a fake host only', () => {
  it('submits the comment without client logs and keeps the report and id out of the journal', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    connection.replies.set('droid.submit_bug_report', () => ({ bugReportId: 'fake-report-1' }))

    expect(
      await h.adapter.droidCommand({
        sessionId: DROID_RIG_SESSION,
        fence: 7,
        command: { name: 'bug', userComment: 'fake private comment' }
      })
    ).toEqual({ name: 'bug', submitted: true })

    expect(
      connection.requests.filter(({ method }) => method === 'droid.submit_bug_report')
    ).toEqual([
      { method: 'droid.submit_bug_report', params: { userComment: 'fake private comment' } }
    ])
    expect(connection.requests.map(({ method }) => method)).not.toContain('droid.add_user_message')
    expect(await h.rig.rows()).toEqual([])
    expect(await h.rig.turns()).toEqual([])
  })

  it('keeps an older chat alive after a missing method, and can read its credits', async () => {
    const h = await setupDroidAdapter()
    const { connection } = await h.start()
    connection.replies.set('droid.submit_bug_report', () => {
      throw new DroidRpcError(-32601, 'Method not found')
    })

    await expect(
      h.adapter.droidCommand({
        sessionId: DROID_RIG_SESSION,
        fence: 7,
        command: { name: 'bug' }
      })
    ).rejects.toThrow('Sending a bug report needs a newer Droid. Update Droid and try again.')
    expect(connection.closed).toBe(false)
    expect(
      await h.adapter.droidCommand({
        sessionId: DROID_RIG_SESSION,
        fence: 7,
        command: { name: 'credits' }
      })
    ).toEqual({ name: 'credits', factoryCredits: null })
    expect(await h.rig.rows()).toEqual([])
  })
})
