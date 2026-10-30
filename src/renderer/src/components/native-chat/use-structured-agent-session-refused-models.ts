import { useCallback, useState } from 'react'
import type { AgentSessionOptionResult } from '../../../../shared/agent-session-wire'
import type { AgentType } from '../../../../shared/agent-status-types'
import { isProviderExplainedOptionRefusal } from '../../../../shared/agent-session-refusal-notice'
import type { AgentSessionWriteFailure } from '../../../../shared/agent-session-write-failure'
import type { StructuredAgentSessionMutate } from './use-structured-agent-session-mutate'

const NO_MODELS: readonly string[] = []

type RefusedModels = { runtimeKey: string; ids: readonly string[] }

/**
 * Sends an option change, and keeps the Droid models Droid refuses with a reason. They stay listed
 * and a key that cycles models moves past them. Held for one runtime: a restart asks Droid afresh.
 */
export function useStructuredAgentSessionRefusedModels(args: {
  agent: AgentType
  runtimeKey: string
  mutate: StructuredAgentSessionMutate
}): {
  refusedModelIds: readonly string[]
  mutateOption: (
    id: string,
    encoded: string,
    isCurrent: () => boolean
  ) => Promise<AgentSessionOptionResult | null>
} {
  const { agent, mutate, runtimeKey } = args
  const [held, setHeld] = useState<RefusedModels>({ runtimeKey, ids: NO_MODELS })
  const mutateOption = useCallback(
    async (id: string, encoded: string, isCurrent: () => boolean) => {
      const send = (...onNotDone: [] | [(failure: AgentSessionWriteFailure) => void]) =>
        mutate<AgentSessionOptionResult>(
          'agentSession.setOption',
          'agentSession.setOption',
          { key: id, value: encoded },
          ...onNotDone
        )
      if (agent !== 'droid' || id !== 'model') {
        return send()
      }
      const result = await send((failure) => {
        if (isProviderExplainedOptionRefusal(failure) && isCurrent()) {
          setHeld((current) => {
            const ids = current.runtimeKey === runtimeKey ? current.ids : NO_MODELS
            return ids.includes(encoded) ? current : { runtimeKey, ids: [...ids, encoded] }
          })
        }
      })
      if (result) {
        setHeld((current) =>
          current.runtimeKey === runtimeKey && current.ids.includes(encoded)
            ? { runtimeKey, ids: current.ids.filter((known) => known !== encoded) }
            : current
        )
      }
      return result
    },
    [agent, mutate, runtimeKey]
  )
  return { refusedModelIds: held.runtimeKey === runtimeKey ? held.ids : NO_MODELS, mutateOption }
}
