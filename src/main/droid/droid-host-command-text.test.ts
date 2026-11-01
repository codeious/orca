import { afterEach, describe, expect, it } from 'vitest'
import type { DroidHostCommand } from '../../shared/droid-host-command'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter
} from './droid-adapter-rig.test-support'

afterEach(runDroidRigCleanups)

async function sessionIn() {
  const h = await setupDroidAdapter({ cwd: '/work/probe' }, undefined, {
    realpath: async (path) => path
  })
  const { connection } = await h.start()
  const run = (command: DroidHostCommand) =>
    h.adapter.droidCommand({ sessionId: DROID_RIG_SESSION, fence: 7, command })
  return { h, connection, run }
}

describe('Droid command host text', () => {
  it.each([
    {
      reply: { newSessionId: 'another-session', removedCount: 5 },
      key: 'compressMoved',
      text: 'Conversation compressed into a new Droid session. The earlier session stays in Session History.'
    },
    {
      reply: { removedCount: 0 },
      key: 'compressDone',
      text: 'Conversation compressed to free up context.'
    },
    {
      reply: { removedCount: 1 },
      key: 'compressOne',
      text: 'Conversation compressed. 1 earlier message was summarized to free up context.',
      params: { removedCount: 1 }
    },
    {
      reply: { removedCount: 5 },
      key: 'compressMany',
      text: 'Conversation compressed. 5 earlier messages were summarized to free up context.',
      params: { removedCount: 5 }
    }
  ])(
    'journals the whole $key sentence and its parameters',
    async ({ reply, key, text, params }) => {
      const { h, connection, run } = await sessionIn()
      connection.replies.set('droid.compact_session', () => reply)

      await run({ name: 'compress' })

      const statuses = (await h.rig.rows()).flatMap(({ body }) =>
        body.kind === 'status' ? [body] : []
      )
      expect(statuses).toEqual([
        {
          kind: 'status',
          text,
          textKey: `components.native-chat.droidHost.${key}`,
          ...(params ? { textParams: params } : {})
        }
      ])
    }
  )

  it.each([
    [' ', 'renameEmpty', 'Give the chat a title to rename it to.'],
    ['A title', 'renameRefused', 'Droid did not rename the conversation.']
  ])('preserves the rename refusal and supplies %s metadata', async (title, key, message) => {
    const { connection, run } = await sessionIn()
    connection.replies.set('droid.rename_session', () => ({ success: false }))

    await expect(run({ name: 'rename', title })).rejects.toMatchObject({
      message,
      textKey: `components.native-chat.droidHost.${key}`
    })
  })
})

describe('Droid working folder host text', () => {
  it.each([
    {
      path: ' ',
      key: 'cwdEmpty',
      message: 'Give a folder to change to.'
    },
    {
      path: '/work/elsewhere',
      key: 'cwdOutside',
      message:
        'Choose a folder inside this workspace (/work/probe). /work/elsewhere is outside it.',
      params: { folder: '/work/probe', target: '/work/elsewhere' }
    }
  ])(
    'preserves the $key refusal and its path parameters',
    async ({ path, key, message, params }) => {
      const { run } = await sessionIn()

      await expect(run({ name: 'cwd', path })).rejects.toMatchObject({
        message,
        textKey: `components.native-chat.droidHost.${key}`,
        ...(params ? { textParams: params } : {})
      })
    }
  )
})

describe('Droid skill host text', () => {
  it('keys an unreadable skill listing without including provider content', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set('droid.list_skills', () => ({ skills: 'private content' }))

    await expect(run({ name: 'skills' })).rejects.toMatchObject({
      message: 'Droid did not list its skills. Try again.',
      textKey: 'components.native-chat.droidHost.skillsUnreadable'
    })
  })

  it.each([
    {
      key: 'skillUnknown',
      message: 'Droid has no skill named review.',
      known: false,
      disabled: true,
      accepted: true
    },
    {
      key: 'skillNotOff',
      message: 'Droid did not turn review off.',
      known: true,
      disabled: true,
      accepted: false
    },
    {
      key: 'skillNotOn',
      message: 'Droid did not turn review on.',
      known: true,
      disabled: false,
      accepted: false
    },
    {
      key: 'skillStillOn',
      message: 'Droid still lists review as on.',
      known: true,
      disabled: true,
      accepted: true
    },
    {
      key: 'skillStillOff',
      message: 'Droid still lists review as off.',
      known: true,
      disabled: false,
      accepted: true
    }
  ])('keys $key with only the skill name', async ({ key, message, known, disabled, accepted }) => {
    const { connection, run } = await sessionIn()
    connection.replies.set('droid.list_skills', () => ({
      skills: known ? [{ name: 'review', enabled: disabled }] : []
    }))
    connection.replies.set('droid.set_skill_disabled', () => ({ success: accepted }))

    await expect(
      run({ name: 'skills', toggle: { skillName: 'review', disabled } })
    ).rejects.toMatchObject({
      message,
      textKey: `components.native-chat.droidHost.${key}`,
      textParams: { skillName: 'review' }
    })
  })
})
