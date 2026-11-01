import type { resolveCliCommand } from '../../shared/node-cli-command-resolution'
import { probeAgentCliVersion, readAgentCliVersion } from '../agent-cli-version-probe'
import {
  resolveStructuredAgentCommand,
  type StructuredAgentCommandSettings
} from '../native-chat/structured-agent-command-resolution'
import type { UnsupportedAgentVersion } from '../native-chat/structured-agent-session-create-support'
import { droidKeyringEnvironment } from './droid-environment'
import { isSupportedDroidVersion, unsupportedDroidRelease } from './droid-version-support'

type DroidLaunchTarget = { command: string; cwd: string; env: Record<string, string> }

/** The binary a Droid launch with `env` spawns; create support resolves through here too. */
export function resolveDroidCommand(
  env: Readonly<Record<string, string>>,
  commandSettings: StructuredAgentCommandSettings = {},
  resolve?: typeof resolveCliCommand
): string {
  const homePath = env.HOME ?? env.USERPROFILE
  return resolveStructuredAgentCommand(
    'droid',
    commandSettings,
    { pathEnv: env.PATH ?? env.Path ?? null, ...(homePath ? { homePath } : {}) },
    resolve ? { resolve } : {}
  )
}

export function droidVersionSupported(
  launch: DroidLaunchTarget,
  probe: typeof probeAgentCliVersion = probeAgentCliVersion,
  orcaEnv: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  return probe(
    {
      program: launch.command,
      cwd: launch.cwd,
      env: { ...launch.env, ...droidKeyringEnvironment(orcaEnv) }
    },
    isSupportedDroidVersion
  )
}

/** What `droid --version` prints under the launch's environment; null when it can't be read. */
export function readDroidVersion(
  launch: DroidLaunchTarget,
  read: typeof readAgentCliVersion = readAgentCliVersion,
  orcaEnv: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  return read({
    program: launch.command,
    cwd: launch.cwd,
    env: { ...launch.env, ...droidKeyringEnvironment(orcaEnv) }
  })
}

/** The installed release when its age alone is why the chat can't run; null when it can't be read
 *  or is not simply older, since a missing binary is the launch's refusal to state. */
export async function droidUnsupportedVersion(
  launch: DroidLaunchTarget,
  read: typeof readAgentCliVersion = readAgentCliVersion,
  orcaEnv: NodeJS.ProcessEnv = process.env
): Promise<UnsupportedAgentVersion | null> {
  const version = await readDroidVersion(launch, read, orcaEnv)
  return version === null ? null : unsupportedDroidRelease(version)
}
