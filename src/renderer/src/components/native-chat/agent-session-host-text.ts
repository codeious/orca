import { translate } from '@/i18n/i18n'
import { readAgentSessionHostText } from '../../../../shared/agent-session-host-text'
import { DROID_HOST_COPY } from '../../../../shared/droid-host-copy'

const PREFIX = 'components.native-chat.droidHost.'

/** Only known host keys are interpreted; older hosts and newer keys keep their English. */
export function agentSessionHostText(fallback: string, value: unknown): string {
  const { textKey, textParams } = readAgentSessionHostText(value)
  const entry = Object.entries(DROID_HOST_COPY).find(([key]) => `${PREFIX}${key}` === textKey)
  if (!entry || !textKey) {
    return fallback
  }
  const template = entry[1]
  const parameters = [...template.matchAll(/\{\{(\w+)\}\}/g)]
  if (parameters.some((match) => textParams?.[match[1]!] === undefined)) {
    return fallback
  }
  return translate(textKey, template, textParams)
}
