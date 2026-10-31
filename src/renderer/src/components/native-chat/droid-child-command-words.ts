import { translate } from '@/i18n/i18n'
import type { AgentSessionContextReport } from '../../../../shared/agent-session-context-usage'
import { hasRuntimeRpcErrorCode } from '../../../../shared/runtime-rpc-error-code'
import { summarizeContextUsage } from './native-chat-context-usage-summary'

// Exact figures, so a person can set them beside what Droid reported.
const COUNT = new Intl.NumberFormat('en-US')
const CREDITS = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })

/** One paragraph: the notice that shows it does not keep line breaks. */
export function droidContextWords(report: AgentSessionContextReport): string {
  const { usedTokens, windowTokens, percentage, categories } = report
  const used = translate(
    'components.native-chat.droidChildCommands.contextUsed',
    'Context: {{used}} of {{window}} tokens used ({{percent}}%), {{left}} left.',
    {
      used: COUNT.format(usedTokens),
      window: COUNT.format(windowTokens),
      percent: String(percentage),
      left: COUNT.format(Math.max(0, windowTokens - usedTokens))
    }
  )
  const { rows } = summarizeContextUsage({
    usedTokens,
    windowTokens,
    percentage,
    estimated: false,
    categories
  })
  if (rows.length === 0) {
    return used
  }
  const listed = rows
    .map((row) =>
      translate(
        'components.native-chat.droidChildCommands.contextRow',
        '{{name}} {{tokens}} ({{percent}}%)',
        { name: row.name, tokens: COUNT.format(row.tokens), percent: String(row.percentage) }
      )
    )
    .join(', ')
  const byCategory = translate(
    'components.native-chat.droidChildCommands.contextRows',
    'By category: {{rows}}.',
    { rows: listed }
  )
  return `${used} ${byCategory}`
}

/**
 * What a Droid command that failed tells the person: the host's own sentence. `newCommand` is for
 * a command an older server has not heard of, which its schema refuses without a sentence of ours.
 */
export function droidCommandFailureWords(
  error: unknown,
  name: string,
  newCommand: boolean
): string {
  if (newCommand && hasRuntimeRpcErrorCode(error, 'invalid_argument')) {
    return translate(
      'components.native-chat.droidChildCommands.needsNewerServer',
      'Droid chat commands need a newer Orca server. Update the server and try again.'
    )
  }
  const words = error instanceof Error ? error.message.trim() : ''
  return (
    words ||
    translate(
      'components.native-chat.droidChildCommands.failed',
      'Could not run /{{name}}. Try again.',
      {
        name
      }
    )
  )
}

/** Null when Droid has reported no credits: no figure is made up. */
export function droidCreditsWords(factoryCredits: number | null): string {
  return factoryCredits === null
    ? translate(
        'components.native-chat.droidChildCommands.creditsNone',
        'Droid has not reported Factory credits for this session yet.'
      )
    : translate(
        'components.native-chat.droidChildCommands.credits',
        'Factory credits used in this session: {{credits}}.',
        { credits: CREDITS.format(factoryCredits) }
      )
}
