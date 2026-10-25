import { describe, expect, it } from 'vitest'
import { parseResumeInvocation } from './structured-session-resume-grammar'

const ID = '7b0a8f5e-4c1d-4e22-9a31-5d6c0b7e1f24'

type Shell = 'posix' | 'cmd' | 'powershell'

// The `cd <cwd> && <agent> --resume <id>` shapes the vault and the renderer build, per shell.
function vaultCommand(shell: Shell, folder: string, agentArgs: string): string {
  if (shell === 'posix') {
    return `cd '/home/me/${folder}' && ${agentArgs}`
  }
  if (shell === 'cmd') {
    return `set "CODEX_HOME=" & cd /d "C:\\Users\\me\\${folder}" && ${agentArgs}`
  }
  return `Set-Location -LiteralPath 'C:\\Users\\me\\${folder}'; ${agentArgs}`
}

const PROVIDER_COMMANDS = [
  { provider: 'claude', args: `claude --resume ${ID}` },
  { provider: 'codex', args: `codex resume ${ID}` },
  { provider: 'droid', args: `droid --resume ${ID}` }
] as const

describe('resume command parsing', () => {
  describe('executable position', () => {
    it.each(
      PROVIDER_COMMANDS.flatMap(({ provider, args }) =>
        (['posix', 'cmd', 'powershell'] as const).flatMap((shell) =>
          ['droid', 'claude', 'codex', 'my droid repo'].map((folder) => ({
            provider,
            shell,
            folder,
            command: vaultCommand(shell, folder, args)
          }))
        )
      )
    )(
      'names the $provider command whatever the $shell folder "$folder" is called',
      ({ provider, command }) => {
        expect(parseResumeInvocation(command)).toEqual({ provider, target: ID })
      }
    )

    it.each([
      {
        name: 'a quoted environment value with spaces',
        command: `cd '/h' && CODEX_HOME='/Users/me/Library/Application Support/Orca/home' codex resume '${ID}'`,
        expected: { provider: 'codex', target: ID }
      },
      {
        name: 'env with an unset option',
        command: `cd '/h' && env -u CODEX_HOME -u ORCA_CODEX_HOME codex '-c' 'x=y' 'resume' '${ID}'`,
        expected: { provider: 'codex', target: ID }
      },
      {
        name: 'a variable assignment prefix',
        command: `FOO=bar claude --resume ${ID}`,
        expected: { provider: 'claude', target: ID }
      },
      {
        name: 'env and a variable assignment',
        command: `env FOO=bar droid -r ${ID}`,
        expected: { provider: 'droid', target: ID }
      },
      {
        name: 'exec',
        command: `exec codex resume ${ID}`,
        expected: { provider: 'codex', target: ID }
      },
      {
        name: 'command',
        command: `command droid --resume ${ID}`,
        expected: { provider: 'droid', target: ID }
      },
      {
        name: 'sudo naming a user that is also an agent',
        command: `sudo -u droid claude --resume ${ID}`,
        expected: { provider: 'claude', target: ID }
      },
      {
        name: 'nohup',
        command: `nohup claude --resume ${ID}`,
        expected: { provider: 'claude', target: ID }
      },
      {
        name: 'a path to the executable',
        command: `~/.local/bin/droid --resume ${ID}`,
        expected: { provider: 'droid', target: ID }
      },
      {
        name: 'a Windows executable path',
        command: `& 'C:\\Program Files\\tools\\claude.exe' --resume ${ID}`,
        expected: { provider: 'claude', target: ID }
      },
      {
        name: 'a pipe',
        command: `echo droid | claude --resume ${ID}`,
        expected: { provider: 'claude', target: ID }
      },
      {
        name: 'a semicolon',
        command: `ls codex; claude --resume ${ID}`,
        expected: { provider: 'claude', target: ID }
      },
      {
        name: 'an or-list',
        command: `cd /repo/droid || claude --resume ${ID}`,
        expected: { provider: 'claude', target: ID }
      },
      {
        name: 'an operator with no spaces around it',
        command: `cd /repo/droid&&claude --resume ${ID}`,
        expected: { provider: 'claude', target: ID }
      },
      {
        name: 'a subshell',
        command: `(cd /repo/droid && claude --resume ${ID})`,
        expected: { provider: 'claude', target: ID }
      },
      {
        name: 'a command substitution',
        command: `echo $(codex resume ${ID})`,
        expected: { provider: 'codex', target: ID }
      },
      {
        name: 'a second line',
        command: `cd /repo/droid\nclaude --resume ${ID}`,
        expected: { provider: 'claude', target: ID }
      },
      {
        name: 'a Windows drive root with a trailing backslash',
        command: `cd /d "C:\\" && claude --resume ${ID}`,
        expected: { provider: 'claude', target: ID }
      },
      {
        name: 'an earlier command of the same agent that resumes nothing',
        command: `claude --version && claude --resume ${ID}`,
        expected: { provider: 'claude', target: ID }
      },
      {
        name: 'a redirect that contains an ampersand',
        command: `claude --resume ${ID} 2>&1`,
        expected: { provider: 'claude', target: ID }
      }
    ])('finds the command in $name', ({ command, expected }) => {
      expect(parseResumeInvocation(command)).toEqual(expected)
    })

    it.each([
      `cd '/home/me/droid'`,
      `cd '/home/me/droid' && ls`,
      `ls droid claude codex`,
      `git -C ~/codex log --oneline`,
      `echo claude --resume ${ID}`,
      `cd /repo/droid && echo codex resume ${ID}`,
      `cat notes/claude`
    ])('finds no agent command in: %s', (command) => {
      expect(parseResumeInvocation(command)).toBeNull()
    })
  })
})
