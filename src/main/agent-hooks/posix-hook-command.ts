import { quotePosixShell } from '../../shared/shell-argument-quoting'
import { POSIX_HOOK_STDIN_DRAIN_COMMAND } from './hook-stdin-contract'

// Missing scripts must become silent no-ops rather than fail every tool call.
export function wrapPosixHookCommand(
  scriptPath: string,
  env: Record<string, string> = {},
  // Gate events treat silence as denial, so missing scripts may need fallback stdout.
  options: { fallbackStdout?: string; requiredEnvVar?: string; parentCapture?: string } = {}
): string {
  // Keep arbitrary paths literal across shell metacharacters.
  const quoted = quotePosixShell(scriptPath)
  const envPrefix = Object.entries(env)
    .map(([key, value]) => `${key}=${quotePosixShell(value)}`)
    .join(' ')
  // Why: the capture must run in this command shell, where $PPID is the agent, not in the script's own shell.
  const invocation = `${options.parentCapture ?? ''}${envPrefix ? `${envPrefix} /bin/sh ${quoted}` : `/bin/sh ${quoted}`}`
  const fallback =
    options.fallbackStdout === undefined
      ? POSIX_HOOK_STDIN_DRAIN_COMMAND
      : `printf '%s\\n' ${quotePosixShell(options.fallbackStdout)}; ${POSIX_HOOK_STDIN_DRAIN_COMMAND}`
  // Default-form variables survive Grok prechecks and defer environment reads to invocation.
  const guards = [
    ...(options.requiredEnvVar ? [`[ -n "\${${options.requiredEnvVar}-}" ]`] : []),
    `[ -f ${quoted} ]`,
    `[ -r ${quoted} ]`,
    `[ -x ${quoted} ]`
  ].join(' && ')
  return `if ${guards}; then ${invocation}; else ${fallback}; fi`
}
