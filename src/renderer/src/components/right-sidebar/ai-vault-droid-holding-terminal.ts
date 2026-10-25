import type { AiVaultDroidHoldingPane } from '../../../../shared/ai-vault-droid-session-holder'
import {
  resolveOriginalPaneTarget,
  type AiVaultOriginalPaneTarget,
  type PaneLocationState
} from './ai-vault-original-pane'

/**
 * The terminal Orca can open for a Droid session its host says is held. Only a pane the host
 * proved live counts: an unverifiable one may hold nothing, so it is never presented as the holder.
 * A pane this window has no tab for (one on a paired host) resolves to nothing rather than a guess.
 */
export function resolveAiVaultDroidHoldingTerminal(args: {
  state: PaneLocationState
  panes: readonly AiVaultDroidHoldingPane[] | undefined
}): AiVaultOriginalPaneTarget | null {
  for (const pane of args.panes ?? []) {
    if (pane.verdict !== 'live') {
      continue
    }
    const target = resolveOriginalPaneTarget({ state: args.state, paneKey: pane.paneKey })
    if (target) {
      return target
    }
  }
  return null
}
