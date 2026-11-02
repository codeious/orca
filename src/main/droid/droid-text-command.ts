import type { AgentSessionHostCommandResult } from '../../shared/agent-session/agent-session-host-command'
import { DROID_TEXT_COMMANDS } from './droid-command-catalog'
import type { DroidSession } from './droid-session'

export async function runDroidTextCommand(
  session: Pick<DroidSession, 'context' | 'lane'>,
  input: { name: string; argument: string; operationId: string }
): Promise<AgentSessionHostCommandResult> {
  if (input.argument) {
    throw new Error(`/${input.name} does not take arguments`)
  }
  let text: string
  switch (input.name) {
    case 'context': {
      const report = await session.context.refresh()
      text = report
        ? `${report.model}: ${report.usedTokens} / ${report.windowTokens} tokens (${report.percentage}%)`
        : 'Droid has not reported context usage.'
      break
    }
    case 'cost':
      text =
        session.context.credits === undefined
          ? 'Droid has not reported session credits.'
          : `Session credits: ${session.context.credits}`
      break
    case 'help':
      text = [
        '/model, /effort: choose the model and reasoning effort',
        '/clear, /new: clear conversation context',
        '/compact, /compress: compact conversation context',
        ...DROID_TEXT_COMMANDS.filter(({ name }) => name !== 'help').map(
          ({ name, description }) => `/${name}: ${description}`
        )
      ].join('\n')
      break
    default:
      throw new Error('This command is unavailable in Droid chat')
  }
  session.lane.apply([
    {
      type: 'item.close',
      item: `host-command:${input.operationId}`,
      body: { kind: 'status', text }
    }
  ])
  return { text }
}
