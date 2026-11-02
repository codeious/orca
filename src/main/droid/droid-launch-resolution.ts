import type { resolveCliCommand } from '../../shared/node-cli-command-resolution'
import {
  readAgentCliVersion,
  type AgentCliVersionReader
} from '../agent-launch/preflight/agent-cli-version-probe'
import {
  resolveStructuredAgentCommand,
  type StructuredAgentCommand,
  type StructuredAgentCommandSettings
} from '../native-chat/structured-agent-command-resolution'
import type { AgentCliInstallationProblem } from '../../shared/agent-cli-installation-problem'
import { droidKeyringEnvironment } from './droid-environment'
import { isSupportedDroidVersion, unsupportedDroidRelease } from './droid-version-support'

type DroidLaunchTarget = {
  command: string
  prefixArgs?: readonly string[]
  cwd: string
  env: Record<string, string>
}

/** The binary a Droid launch with `env` spawns; create support resolves through here too. */
export function resolveDroidCommand(
  env: Readonly<Record<string, string>>,
  commandSettings: StructuredAgentCommandSettings = {},
  resolve?: typeof resolveCliCommand
): StructuredAgentCommand {
  const homePath = env.HOME ?? env.USERPROFILE
  return resolveStructuredAgentCommand(
    'droid',
    commandSettings,
    { pathEnv: env.PATH ?? env.Path ?? null, ...(homePath ? { homePath } : {}) },
    resolve ? { resolve } : {}
  )
}

export async function droidVersionSupported(
  launch: DroidLaunchTarget,
  read: AgentCliVersionReader = readAgentCliVersion,
  orcaEnv: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const version = await readDroidVersion(launch, read, orcaEnv)
  return version !== null && isSupportedDroidVersion(version)
}

/** What `droid --version` prints under the launch's environment; null when it can't be read. */
export async function readDroidVersion(
  launch: DroidLaunchTarget,
  read: AgentCliVersionReader = readAgentCliVersion,
  orcaEnv: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const { version } = await read({
    program: launch.command,
    prefixArgs: launch.prefixArgs,
    cwd: launch.cwd,
    env: { ...launch.env, ...droidKeyringEnvironment(orcaEnv) }
  })
  return version
}

/** The installed release when its age alone is why the chat can't run; null when it can't be read
 *  or is not simply older, since a missing binary is the launch's refusal to state. */
export async function droidUnsupportedVersion(
  launch: DroidLaunchTarget,
  read: AgentCliVersionReader = readAgentCliVersion,
  orcaEnv: NodeJS.ProcessEnv = process.env
): Promise<AgentCliInstallationProblem | null> {
  const version = await readDroidVersion(launch, read, orcaEnv)
  return version === null ? null : unsupportedDroidRelease(version)
}
