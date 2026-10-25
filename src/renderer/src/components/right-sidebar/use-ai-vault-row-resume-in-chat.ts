import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { AiVaultDroidSessionHolder } from '../../../../shared/ai-vault-droid-session-holder'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { resolveAiVaultDroidHoldingTerminal } from './ai-vault-droid-holding-terminal'
import type { AiVaultResumeInChatEligibility } from './ai-vault-session-resume-in-chat'
import { resolveAiVaultHistoryRowResume } from './ai-vault-session-resume-in-chat-workspace'
import { useAiVaultDroidHolders } from './use-ai-vault-droid-holders'

type RowResumeArgs = Parameters<typeof resolveAiVaultHistoryRowResume>[0]

/**
 * Each history row's resume-in-chat answer, with the owning host's word on who holds a Droid row
 * folded in. Only Droid rows the workspace would otherwise offer are asked about; a row with no
 * answer yet reaches the resolver as `undefined`, which it reads as cannot-tell, never as free.
 * A held row also carries the open terminal the host named, when this window can open it.
 */
export function useAiVaultRowResumeInChat({
  sessions,
  rowArgs,
  settings,
  generation
}: {
  sessions: readonly AiVaultSession[]
  rowArgs: (session: AiVaultSession) => Omit<RowResumeArgs, 'settings' | 'droidHolder'>
  settings: RowResumeArgs['settings']
  generation: unknown
}): (session: AiVaultSession) => AiVaultResumeInChatEligibility {
  const resolve = useCallback(
    (session: AiVaultSession, droidHolder?: AiVaultDroidSessionHolder) =>
      resolveAiVaultHistoryRowResume({ ...rowArgs(session), settings, droidHolder }).resumeInChat,
    [rowArgs, settings]
  )
  const droidRowsToAsk = useMemo(
    () => sessions.filter((session) => session.agent === 'droid' && resolve(session).available),
    [resolve, sessions]
  )
  const holders = useAiVaultDroidHolders({ sessions: droidRowsToAsk, generation })
  const paneState = useAppStore(
    useShallow((s) => ({
      tabsByWorktree: s.tabsByWorktree,
      terminalLayoutsByTabId: s.terminalLayoutsByTabId
    }))
  )
  return useCallback(
    (session) => {
      const answer = holders.get(session.id)
      const eligibility = resolve(session, answer?.holder)
      if (eligibility.available || eligibility.reason !== 'held') {
        return eligibility
      }
      const openTerminal = resolveAiVaultDroidHoldingTerminal({
        state: paneState,
        panes: answer?.panes
      })
      return openTerminal ? { ...eligibility, openTerminal } : eligibility
    },
    [holders, paneState, resolve]
  )
}
