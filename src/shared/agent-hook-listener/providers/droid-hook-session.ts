import type { ProviderHookSession } from '../provider-hook-session'
import { normalizeDroidEvent } from './droid-events'
import {
  admitDroidHook,
  droidExitMarker,
  droidRowProviderSession,
  restatedDroidEvent
} from './droid-sessions'

export const DROID_HOOK_SESSION_PROVIDER: ProviderHookSession = {
  admit({ state, paneKey, eventName, hookPayload, promptText, sender, previous, base }) {
    const admission = admitDroidHook(state, paneKey, eventName, hookPayload, sender, previous)
    if (admission.kind === 'skip' || admission.kind === 'restate') {
      return {
        kind: 'handled',
        event: restatedDroidEvent(previous, admission, base)
      }
    }
    return {
      kind: 'normalize',
      normalization: {
        normalize: () =>
          normalizeDroidEvent(state, eventName, promptText, paneKey, hookPayload, admission),
        providerSession: droidRowProviderSession(admission, base.providerSession ?? null),
        suppressPrompt: admission.kind === 'child'
      }
    }
  },
  exitMarker: droidExitMarker
}
