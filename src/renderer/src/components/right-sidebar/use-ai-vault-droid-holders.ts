import { useEffect, useRef, useState } from 'react'
import type { AiVaultDroidSessionHolderResult } from '../../../../shared/ai-vault-droid-session-holder'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { askAiVaultDroidSessionHolder } from './ai-vault-droid-session-holder-check'

const NO_HOLDERS: ReadonlyMap<string, AiVaultDroidSessionHolderResult> = new Map()

/**
 * What the owning host says holds each listed Droid row, keyed by the row's id. A row with no entry
 * has not been answered yet, which the eligibility reads as cannot-tell; a `null` holder is the
 * host's proof that nobody holds it. The answer is only for showing the row: the click asks again.
 *
 * `generation` is whatever changes when the list is rescanned, since a terminal may have started or
 * ended since the last answer.
 */
export function useAiVaultDroidHolders({
  sessions,
  generation
}: {
  sessions: readonly AiVaultSession[]
  generation: unknown
}): ReadonlyMap<string, AiVaultDroidSessionHolderResult> {
  const [holders, setHolders] = useState(NO_HOLDERS)
  const latestSessions = useRef(sessions)
  useEffect(() => {
    latestSessions.current = sessions
  })
  const rowKey = sessions.map((session) => session.id).join('\n')

  useEffect(() => {
    let superseded = false
    for (const session of latestSessions.current) {
      void askAiVaultDroidSessionHolder(session).then((answer) => {
        if (!superseded) {
          setHolders((current) => new Map(current).set(session.id, answer))
        }
      })
    }
    return () => {
      superseded = true
    }
  }, [rowKey, generation])

  return holders
}
