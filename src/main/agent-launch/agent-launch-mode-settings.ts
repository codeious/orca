import type { NativeChatDefaultSettings } from '../../shared/structured-native-chat-launch-route'

/** A desktop stamp supplies its resolved preference for the launched agent; other callers read the host’s settings. */
export function readAgentLaunchModeSettings(
  runtime: { requireStore(): { getSettings(): NativeChatDefaultSettings | null } },
  caller?: { agent?: string; nativeChatDefault?: boolean }
): NativeChatDefaultSettings | null {
  if (caller?.nativeChatDefault !== undefined) {
    return caller.agent === undefined
      ? {}
      : { nativeChatProviders: { [caller.agent]: caller.nativeChatDefault } }
  }
  try {
    return runtime.requireStore().getSettings()
  } catch (error) {
    console.warn('[agent-launch] could not resolve chat preference', error)
    return null
  }
}
