import { afterEach, describe, expect, it } from 'vitest'
import type { DroidHostCommand, DroidHostCommandResult } from '../../shared/droid-host-command'
import {
  DROID_RIG_SESSION,
  runDroidRigCleanups,
  setupDroidAdapter,
  type FakeConnection,
  type Reply
} from './droid-adapter-rig.test-support'
import { readDroidExchanges, replayExchange } from './droid-recording.test-support'
import { DroidRpcError } from './droid-rpc-errors'

afterEach(runDroidRigCleanups)

const WORKSPACE = '/work/probe'

async function sessionIn(workspace = WORKSPACE, realpath = async (path: string) => path) {
  const h = await setupDroidAdapter({ cwd: workspace }, undefined, { realpath })
  const { connection } = await h.start()
  const run = (command: DroidHostCommand) =>
    h.adapter.droidCommand({ sessionId: DROID_RIG_SESSION, fence: 7, command })
  return { h, connection, run }
}

const asked = (connection: FakeConnection, method: string) =>
  connection.requests.filter((request) => request.method === method)

describe('Droid /cwd and /cd', () => {
  const MOVE = 'droid.change_working_directory'
  const cwd = (path: string): DroidHostCommand => ({ name: 'cwd', path })

  it('moves Droid into a folder of the workspace and answers with the folder Droid reports', async () => {
    const { connection, run } = await sessionIn()
    const exchanges = await readDroidExchanges('change-working-directory')
    connection.replies.set(MOVE, replayExchange(connection, exchanges, 'r1'))

    expect(await run(cwd('/work/probe/sub'))).toEqual({
      name: 'cwd',
      resolvedPath: '/work/probe/sub'
    })

    expect(asked(connection, MOVE)).toEqual([
      { method: MOVE, params: { workingDirectory: '/work/probe/sub' } }
    ])
    expect(connection.requests.map(({ method }) => method)).not.toContain('droid.add_user_message')
  })

  it.each([
    ['a folder named from the workspace', 'sub', '/work/probe/sub'],
    ['a folder with a trailing slash', '/work/probe/sub/', '/work/probe/sub'],
    ['a folder reached through dots that stay inside', 'a/../sub', '/work/probe/sub'],
    ['the workspace itself', '/work/probe', '/work/probe'],
    ['the workspace as a dot', '.', '/work/probe']
  ])('takes %s as inside the workspace', async (_label, typed, sent) => {
    const { connection, run } = await sessionIn()

    expect(await run(cwd(typed))).toEqual({ name: 'cwd', resolvedPath: sent })

    expect(asked(connection, MOVE).map(({ params }) => params)).toEqual([
      { workingDirectory: sent }
    ])
  })

  it.each([
    ['a folder elsewhere', '/usr'],
    ['a sibling of the workspace', '/work/outside'],
    ['a sibling that only shares the workspace name', '/work/probe-two'],
    ['the folder above the workspace', '/work'],
    ['the folder above, as dots', '..'],
    ['a sibling, as dots', '../probe-two'],
    ['a folder that backs out of the workspace', '/work/probe/../outside']
  ])('refuses %s without asking Droid', async (_label, typed) => {
    const { connection, run } = await sessionIn()

    await expect(run(cwd(typed))).rejects.toThrow(/inside this workspace \(\/work\/probe\)/)

    expect(asked(connection, MOVE)).toEqual([])
  })

  it.each(['', '   ', '\n'])('asks Droid nothing for the folder %j', async (typed) => {
    const { connection, run } = await sessionIn()

    await expect(run(cwd(typed))).rejects.toThrow('Give a folder to change to.')

    expect(asked(connection, MOVE)).toEqual([])
  })

  it('refuses a folder inside the workspace whose real path is outside it', async () => {
    const { connection, run } = await sessionIn(WORKSPACE, async (path) =>
      path === '/work/probe/link' ? '/work/outside/data' : path
    )

    await expect(run(cwd('link'))).rejects.toThrow(/inside this workspace/)

    expect(asked(connection, MOVE)).toEqual([])
  })

  it('compares real paths when the workspace is reached through a link, and gives Droid the real one', async () => {
    const real = async (path: string) =>
      path.startsWith('/link/folder') ? path.replace('/link/folder', '/real/folder') : path
    const { connection, run } = await sessionIn('/link/folder', real)

    expect(await run(cwd('sub'))).toEqual({ name: 'cwd', resolvedPath: '/real/folder/sub' })

    expect(asked(connection, MOVE).map(({ params }) => params)).toEqual([
      { workingDirectory: '/real/folder/sub' }
    ])
  })

  it('leaves a folder that is not there to Droid, which names it in its own words', async () => {
    const gone = async (path: string) => {
      if (path === '/work/probe/missing') {
        throw new Error('ENOENT')
      }
      return path
    }
    const { connection, run } = await sessionIn(WORKSPACE, gone)
    const exchanges = await readDroidExchanges('change-working-directory')
    connection.replies.set(MOVE, replayExchange(connection, exchanges, 'r3'))

    await expect(run(cwd('missing'))).rejects.toThrow('Working directory does not exist')
    expect(asked(connection, MOVE)).toHaveLength(1)
  })

  it('refuses a missing folder under a link that leads out of the workspace', async () => {
    const real = async (path: string) => {
      if (path === '/work/probe/link/new') {
        throw new Error('ENOENT')
      }
      return path === '/work/probe/link' ? '/work/outside/data' : path
    }
    const { connection, run } = await sessionIn(WORKSPACE, real)

    await expect(run(cwd('link/new'))).rejects.toThrow('/work/outside/data/new is outside it.')

    expect(asked(connection, MOVE)).toEqual([])
  })

  it('still refuses a missing folder that lies outside the workspace', async () => {
    const gone = async (path: string) => {
      throw new Error(`ENOENT ${path}`)
    }
    const { connection, run } = await sessionIn(WORKSPACE, gone)

    await expect(run(cwd('/work/outside/missing'))).rejects.toThrow(/inside this workspace/)

    expect(asked(connection, MOVE)).toEqual([])
  })

  it('passes on Droid’s refusal of a folder it does not trust, in its words', async () => {
    const { connection, run } = await sessionIn()
    const exchanges = await readDroidExchanges('change-working-directory')
    connection.replies.set(MOVE, replayExchange(connection, exchanges, 'r2'))

    await expect(run(cwd('untrusted'))).rejects.toThrow(
      'Folder is not trusted: /work/probe/untrusted. Open it in the Droid CLI and accept the trust prompt, then try again.'
    )
  })

  it('passes on Droid’s refusal to move while it works', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set(MOVE, () => {
      throw new DroidRpcError(
        -32600,
        'Cannot change the working directory while the agent is working'
      )
    })

    await expect(run(cwd('sub'))).rejects.toThrow(
      'Cannot change the working directory while the agent is working'
    )
  })

  it('takes the folder it sent when Droid answers without one', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set(MOVE, () => ({}))

    expect(await run(cwd('sub'))).toEqual({ name: 'cwd', resolvedPath: '/work/probe/sub' })
  })

  it('says Droid needs updating when it has no such method', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set(MOVE, () => {
      throw new DroidRpcError(-32601, 'Method not found')
    })

    await expect(run(cwd('sub'))).rejects.toThrow(
      'Changing the working folder needs a newer Droid. Update Droid and try again.'
    )
  })

  it('opens no turn', async () => {
    const { h, run } = await sessionIn()

    await run(cwd('sub'))

    expect(await h.rig.turns()).toHaveLength(0)
    expect(h.idle).not.toHaveBeenCalled()
  })
})

describe('Droid /skills', () => {
  const LIST = 'droid.list_skills'
  const TOGGLE = 'droid.set_skill_disabled'
  const skills = (toggle?: { skillName: string; disabled: boolean }): DroidHostCommand =>
    toggle ? { name: 'skills', toggle } : { name: 'skills' }

  /** The recorded listings, answered in order: before a change, then after it. */
  const recorded = async (connection: FakeConnection, ...ids: ('r1' | 'r3' | 'r5')[]) => {
    const exchanges = await readDroidExchanges('skills')
    const listings: Reply[] = ids.map((id) => replayExchange(connection, exchanges, id))
    connection.replies.set(LIST, (params) => listings.shift()?.(params))
    connection.replies.set(TOGGLE, replayExchange(connection, exchanges, 'r2'))
  }

  const skillsOf = (result: DroidHostCommandResult) => {
    if (result.name !== 'skills') {
      throw new Error(`answered ${result.name}`)
    }
    return result
  }

  it('lists the skills Droid lists, by name and whether each is on, without their content', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, 'r1')

    const result = skillsOf(await run(skills()))

    expect(asked(connection, LIST)).toEqual([{ method: LIST, params: { includeContent: false } }])
    expect(result.changed).toBeNull()
    expect(result.skills).toHaveLength(23)
    expect(result.skills[0]).toEqual({ name: 'cap-probe', enabled: true })
    expect(result.skills).toContainEqual({ name: 'agent-browser', enabled: true })
    for (const skill of result.skills) {
      expect(Object.keys(skill).sort()).toEqual(['enabled', 'name'])
    }
    expect(asked(connection, TOGGLE)).toEqual([])
  })

  it('reads the skill Droid reports as off from the listing after a disable', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, 'r3')

    const result = skillsOf(await run(skills()))

    expect(result.skills[0]).toEqual({ name: 'cap-probe', enabled: false })
  })

  it('turns a skill off at the user level, then lists again so the answer is what Droid now holds', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, 'r1', 'r3')

    const result = skillsOf(await run(skills({ skillName: 'cap-probe', disabled: true })))

    expect(connection.requests.map(({ method }) => method)).toEqual([
      'droid.initialize_session',
      LIST,
      TOGGLE,
      LIST
    ])
    expect(asked(connection, TOGGLE)[0]?.params).toEqual({
      skillName: 'cap-probe',
      disabled: true,
      settingsLevel: 'user'
    })
    expect(result.changed).toEqual({ skillName: 'cap-probe', disabled: true })
    expect(result.skills[0]).toEqual({ name: 'cap-probe', enabled: false })
    expect(result.skills).toHaveLength(23)
  })

  it('turns a skill back on and lists it as on', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, 'r3', 'r5')

    const result = skillsOf(await run(skills({ skillName: 'cap-probe', disabled: false })))

    expect(asked(connection, TOGGLE)[0]?.params).toEqual({
      skillName: 'cap-probe',
      disabled: false,
      settingsLevel: 'user'
    })
    expect(result.changed).toEqual({ skillName: 'cap-probe', disabled: false })
    expect(result.skills[0]).toEqual({ name: 'cap-probe', enabled: true })
  })

  it('names a skill Droid does not list, and changes nothing, since Droid would accept any name', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, 'r1')

    await expect(run(skills({ skillName: 'nope', disabled: true }))).rejects.toThrow(
      'Droid has no skill named nope.'
    )

    expect(asked(connection, TOGGLE)).toEqual([])
  })

  it('says so when Droid answers that it did not change the skill', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, 'r1')
    connection.replies.set(TOGGLE, () => ({ success: false }))

    await expect(run(skills({ skillName: 'cap-probe', disabled: true }))).rejects.toThrow(
      'Droid did not turn cap-probe off.'
    )
  })

  it('says so when the next listing still shows the skill as it was', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, 'r1', 'r1')

    await expect(run(skills({ skillName: 'cap-probe', disabled: true }))).rejects.toThrow(
      'Droid still lists cap-probe as on.'
    )
  })

  it('answers an empty listing as no skills', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set(LIST, () => ({ skills: [] }))

    expect(await run(skills())).toEqual({ name: 'skills', skills: [], changed: null })
  })

  it.each([
    ['nothing', {}],
    ['a list that is not a list', { skills: 'review' }],
    ['a skill with no name', { skills: [{ enabled: true }] }],
    ['a skill with no on or off', { skills: [{ name: 'review' }] }]
  ])('says so when Droid lists %s it can read', async (_label, answer) => {
    const { connection, run } = await sessionIn()
    connection.replies.set(LIST, () => answer)

    await expect(run(skills())).rejects.toThrow('Droid did not list its skills. Try again.')
  })

  it('says Droid needs updating when it has no skills method', async () => {
    const { connection, run } = await sessionIn()
    connection.replies.set(LIST, () => {
      throw new DroidRpcError(-32601, 'Method not found')
    })

    await expect(run(skills())).rejects.toThrow(
      'Listing skills needs a newer Droid. Update Droid and try again.'
    )
  })

  it('says Droid needs updating when it lists skills but cannot turn one off', async () => {
    const { connection, run } = await sessionIn()
    await recorded(connection, 'r1')
    connection.replies.set(TOGGLE, () => {
      throw new DroidRpcError(-32601, 'Method not found')
    })

    await expect(run(skills({ skillName: 'cap-probe', disabled: true }))).rejects.toThrow(
      'Turning a skill on or off needs a newer Droid. Update Droid and try again.'
    )
  })

  it('opens no turn and sends no message', async () => {
    const { h, connection, run } = await sessionIn()
    await recorded(connection, 'r1', 'r3')

    await run(skills({ skillName: 'cap-probe', disabled: true }))

    expect(await h.rig.turns()).toHaveLength(0)
    expect(connection.requests.map(({ method }) => method)).not.toContain('droid.add_user_message')
  })
})
