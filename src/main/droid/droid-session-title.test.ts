import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter
} from './droid-adapter-rig.test-support'
import { recordDroidTitle } from './droid-session-title'

afterEach(runDroidRigCleanups)

async function startedChat() {
  const onTitle = vi.fn()
  const h = await setupDroidAdapter({}, undefined, { onTitle })
  const { connection } = await h.start()
  const title = (title: unknown, updateType?: unknown, extra: Record<string, unknown> = {}) =>
    connection.notify({
      type: 'session_title_updated',
      title,
      ...(updateType === undefined ? {} : { updateType }),
      ...extra
    })
  const names = () => onTitle.mock.calls.map(([update]) => update)
  return { h, connection, onTitle, title, names }
}

describe('the title Droid gives a chat', () => {
  it('names the chat when Droid writes the title itself', async () => {
    const { title, names } = await startedChat()

    title('Fix the login redirect', 'llm_generated')

    expect(names()).toEqual([{ sessionId: DROID_RIG_SESSION, title: 'Fix the login redirect' }])
  })

  it('names the chat from a title that says nothing about who wrote it', async () => {
    const { title, names } = await startedChat()

    title('Untyped title')

    expect(names()).toEqual([{ sessionId: DROID_RIG_SESSION, title: 'Untyped title' }])
  })

  it('names the chat from a rename Droid reports, with the id of the request that asked for it', async () => {
    const { title, names } = await startedChat()

    title('Chosen by hand', 'manual_rename', { requestId: 'orca-19' })

    expect(names()).toEqual([{ sessionId: DROID_RIG_SESSION, title: 'Chosen by hand' }])
  })

  it('keeps a title that says nothing about its writer from locking the name', async () => {
    const { title, names } = await startedChat()

    title('Untyped title')
    title('Droid’s better title', 'llm_generated')

    expect(names().map(({ title: name }) => name)).toEqual([
      'Untyped title',
      'Droid’s better title'
    ])
  })

  it('does not let a later title replace a name that was renamed by hand', async () => {
    const { title, names } = await startedChat()

    title('Chosen by hand', 'manual_rename')
    title('Untyped title')
    title('Droid’s own title', 'llm_generated')
    title('Some future kind of title', 'a_kind_from_a_later_droid')

    expect(names().map(({ title: name }) => name)).toEqual(['Chosen by hand'])
  })

  it('lets a second rename by hand replace the first', async () => {
    const { title, names } = await startedChat()

    title('First choice', 'manual_rename')
    title('Second choice', 'manual_rename')

    expect(names().map(({ title: name }) => name)).toEqual(['First choice', 'Second choice'])
  })

  it('flattens the title to the one line a name can hold', async () => {
    const { title, names } = await startedChat()

    title('  Two\nlines  ', 'llm_generated')

    expect(names().map(({ title: name }) => name)).toEqual(['Two lines'])
  })

  it.each([
    ['an empty title', ''],
    ['a title of only spaces', '   \n'],
    ['a title that is not text', 7]
  ])('leaves the name alone for %s, and the child running', async (_label, bad) => {
    const { h, title, names } = await startedChat()

    title('Kept', 'llm_generated')
    title(bad, 'llm_generated')
    title('Still kept', 'llm_generated')

    expect(names().map(({ title: name }) => name)).toEqual(['Kept', 'Still kept'])
    expect(h.lifecycle).not.toHaveBeenCalled()
  })

  it('reads a title whose writer is not text as one that says nothing about its writer', async () => {
    const { h, title, names } = await startedChat()

    title('Odd writer', 42)

    expect(names().map(({ title: name }) => name)).toEqual(['Odd writer'])
    expect(h.lifecycle).not.toHaveBeenCalled()
  })

  it('opens no turn and settles no message', async () => {
    const { h, title } = await startedChat()

    title('Just a title', 'llm_generated')

    expect(await h.rig.turns()).toHaveLength(0)
    expect(h.idle).not.toHaveBeenCalled()
    expect(h.settled).not.toHaveBeenCalled()
  })
})

describe('saving the title Droid gave a chat', () => {
  const record = { sessionId: 'session-1', location: { workspaceId: 'workspace-1' } }
  const setup = (save: () => Promise<unknown> = async () => record) => {
    const setConversationName = vi.fn(save)
    const published = vi.fn()
    const logger = { warn: vi.fn(), error: vi.fn() }
    const onTitle = recordDroidTitle({ store: { setConversationName }, publish: published, logger })
    return { onTitle, setConversationName, published, logger }
  }

  it('writes the name on the chat’s record, then tells the lists that show it', async () => {
    const { onTitle, setConversationName, published } = setup()

    onTitle({ sessionId: 'session-1', title: 'Fix the login redirect' })
    await vi.waitFor(() => expect(published).toHaveBeenCalledWith('session-1'))

    expect(setConversationName).toHaveBeenCalledWith('session-1', 'Fix the login redirect')
  })

  it('says nothing to the lists until the name is on the record', async () => {
    let finish: (value: unknown) => void = () => {}
    const { onTitle, published } = setup(() => new Promise((resolve) => (finish = resolve)))

    onTitle({ sessionId: 'session-1', title: 'Slow' })
    await Promise.resolve()
    expect(published).not.toHaveBeenCalled()

    finish(record)
    await vi.waitFor(() => expect(published).toHaveBeenCalledOnce())
  })

  it('logs a name the record would not take, and publishes nothing', async () => {
    const { onTitle, published, logger } = setup(async () => {
      throw new Error('no such session')
    })

    onTitle({ sessionId: 'session-1', title: 'Lost' })
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledOnce())

    expect(logger.warn).toHaveBeenCalledWith(
      'Droid chat title was not saved',
      expect.objectContaining({ scope: 'droid-title', sessionId: 'session-1' })
    )
    expect(published).not.toHaveBeenCalled()
  })
})
