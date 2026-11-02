import { describe, expect, it } from 'vitest'
import { parseDroidResumeArgs } from './droid-resume-grammar'

const id = 'b0b1c2d3-e4f5-4678-9abc-def012345678'

describe('Droid resume argument grammar', () => {
  it.each([
    ['-r', id],
    ['--resume', id],
    [`--resume=${id}`],
    [`-r${id}`],
    [`-r=${id}`],
    ['exec', '-s', id],
    ['exec', '--session-id', id],
    ['exec', `--session-id=${id}`],
    ['resume', id],
    ['resume', '--', id],
    ['--settings', 'config.json', 'resume', id],
    ['--cwd', '/folder with spaces', '--resume', id]
  ])('recognizes %j', (...args) => {
    expect(parseDroidResumeArgs(args)).toEqual({ target: id })
  })

  it.each([
    ['--last'],
    ['--resume'],
    ['--resume', '../invalid'],
    ['resume'],
    ['resume', '--last'],
    ['exec', '-s'],
    ['exec', '--session-id=']
  ])('conservatively guards target-less %j', (...args) => {
    expect(parseDroidResumeArgs(args)).toEqual({ target: null })
  })

  it.each([
    ['--fork', id],
    ['--resume', id, '--fork'],
    ['resume', '--fork', id],
    ['resume', `--fork=${id}`],
    ['exec', '-r', 'high'],
    ['mcp', 'add', '-r', id],
    ['--', '--resume', id],
    ['help', 'resume'],
    ['--append-system-prompt', 'resume']
  ])('does not claim a fork, effort or prompt operand: %j', (...args) => {
    expect(parseDroidResumeArgs(args)).toBeNull()
  })
})
