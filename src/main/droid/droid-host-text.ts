import type { AgentSessionHostText } from '../../shared/agent-session-host-text'
import { DROID_HOST_COPY, type DroidHostCopyKey } from '../../shared/droid-host-copy'

/** The English stays on the wire for clients that predate the key. */
export function droidHostText(
  key: DroidHostCopyKey,
  textParams?: AgentSessionHostText['textParams']
): { text: string } & AgentSessionHostText {
  return {
    text: DROID_HOST_COPY[key].replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      textParams?.[name] === undefined ? match : String(textParams[name])
    ),
    textKey: `components.native-chat.droidHost.${key}`,
    ...(textParams ? { textParams } : {})
  }
}

export class DroidHostTextError extends Error implements AgentSessionHostText {
  readonly textKey?: string
  readonly textParams?: AgentSessionHostText['textParams']

  constructor(key: DroidHostCopyKey, params?: AgentSessionHostText['textParams']) {
    const { text, textKey, textParams } = droidHostText(key, params)
    super(text)
    this.textKey = textKey
    this.textParams = textParams
  }
}
