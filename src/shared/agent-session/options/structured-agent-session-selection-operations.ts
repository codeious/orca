import {
  STRUCTURED_LAUNCH_OPTION_IDS,
  STRUCTURED_LAUNCH_SEED_OPTION_IDS
} from '../../native-chat/input/native-chat-session-option-defaults'
import { decodeStructuredAgentSessionOptionValue } from './structured-agent-session-option-codec'
import type { NativeChatSessionOptionSettingsMutation } from '../../native-chat/input/native-chat-session-options'
import type {
  SelectionOutcome,
  SelectionOperation
} from './structured-agent-session-selection-operation'
export type {
  SelectionOutcome,
  SelectionOperation
} from './structured-agent-session-selection-operation'
import type { StructuredPlanModePair } from './structured-agent-session-plan-mode-pair'

const OPTION_ORDER: readonly string[] = STRUCTURED_LAUNCH_OPTION_IDS

type RememberedPicks = Extract<
  NativeChatSessionOptionSettingsMutation,
  { type: 'apply-picks' }
>['picks']
/** Finite operation precedence above a queried host answer; no mutation reply installs a base. */
export function createStructuredSessionSelectionController(
  remember: (picks: RememberedPicks) => void,
  isCurrent: () => boolean = () => true,
  planModePair: StructuredPlanModePair | null = null
) {
  const pairIds = planModePair ? [planModePair.modelOptionId, planModePair.effortOptionId] : []
  let sequence = 0
  let revision = 0
  let adopted = 0
  const inFlight = new Set<Promise<SelectionOutcome>>()
  const operations = new Map<number, SelectionOperation>()
  const latest = new Map<string, number>()
  const remembered = new Map<string, number>()
  const terminal = new Set<number>()
  let terminalRevision = 0
  // Local untransmitted choices can be replaced; only live requests hold admission.
  const pendingCounts = new Map<string, number>()
  let pendingTail: SelectionOperation | undefined
  const currentOperations = () => [...latest.values()].flatMap((id) => operations.get(id) ?? [])
  const listeners = new Set<() => void>()
  const notify = () => {
    revision += 1
    for (const listener of listeners) {
      listener()
    }
  }
  const settle = (operation: SelectionOperation, outcome: SelectionOutcome): void => {
    if (operation.outcome) {
      return
    }
    if (!isCurrent()) {
      outcome = { kind: 'superseded' }
    }
    operation.outcome = outcome
    if (operation.transmitted) {
      pendingCounts.set(operation.key, (pendingCounts.get(operation.key) ?? 1) - 1)
    }
    if (operation.previousPending) {
      operation.previousPending.nextPending = operation.nextPending
    }
    if (operation.nextPending) {
      operation.nextPending.previousPending = operation.previousPending
    } else {
      pendingTail = operation.previousPending
    }
    operation.previousPending = undefined
    operation.nextPending = undefined
    operation.resolve(outcome)
    if (outcome.kind === 'accepted' || outcome.kind === 'unknown') {
      terminal.add(operation.identity)
      terminalRevision = revision + 1
    }
    if (outcome.kind === 'accepted') {
      const pairPick =
        pairIds.includes(operation.key) ||
        ((operation.key === 'model' || operation.key === 'effort') &&
          outcome.options.planMode === 'true' &&
          pairIds.some((id) => outcome.options[id] !== undefined))
      if (planModePair && pairPick) {
        if ((remembered.get('planModePair') ?? 0) < operation.identity) {
          remembered.set('planModePair', operation.identity)
          const { sameAsMain } = planModePair
          const modelId = outcome.options.model ?? operation.model ?? sameAsMain
          try {
            remember(
              pairIds.map((optionId) => ({
                modelId,
                optionId,
                value: outcome.options[optionId] ?? sameAsMain
              }))
            )
          } catch {
            /* Remembering never gates selection. */
          }
        }
      } else {
        const model =
          operation.key === 'model' ? (outcome.options.model ?? operation.model) : operation.model
        const value = decodeStructuredAgentSessionOptionValue(
          operation.key,
          outcome.options[operation.key] ?? operation.value
        )
        const key = operation.key === 'model' ? 'model' : JSON.stringify([model, operation.key])
        if (
          model &&
          value !== null &&
          STRUCTURED_LAUNCH_SEED_OPTION_IDS.some((id) => id === operation.key) &&
          (remembered.get(key) ?? 0) < operation.identity
        ) {
          remembered.set(key, operation.identity)
          const adopt = adopted <= operation.identity
          adopted = Math.max(adopted, operation.identity)
          try {
            remember([
              {
                modelId: model,
                optionId: operation.key,
                value,
                ...(!adopt || operation.adoptsModel === false
                  ? { adoptModelAsLaunchDefault: false }
                  : {})
              }
            ])
          } catch {
            /* Remembering never gates selection. */
          }
        }
      }
    } else if (outcome.kind !== 'unknown') {
      operations.delete(operation.identity)
    }
    notify()
  }
  const transmit = (
    operation: SelectionOperation,
    send: (operation: SelectionOperation) => Promise<SelectionOutcome>
  ): Promise<SelectionOutcome> => {
    if (!isCurrent() || operation.outcome || operation.transmitted) {
      return operation.request ?? operation.result
    }
    operation.transmitted = true
    pendingCounts.set(operation.key, (pendingCounts.get(operation.key) ?? 0) + 1)
    inFlight.add(operation.result)
    void operation.result.then(() => inFlight.delete(operation.result))
    const request = (async () => send(operation))()
    operation.request = request
    void request.then(
      (outcome) => settle(operation, outcome),
      () => settle(operation, { kind: 'unknown' })
    )
    notify()
    return request
  }
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    snapshot: () => revision,
    issue(
      key: string,
      value: string,
      model: string | null,
      offers?: (key: string, value: string) => boolean,
      onIssue?: (operation: SelectionOperation) => void,
      adoptsModel?: false
    ): SelectionOperation {
      if (!isCurrent()) {
        const outcome = { kind: 'superseded' } as const
        return {
          identity: 0,
          key,
          value,
          model,
          transmitted: false,
          outcome,
          result: Promise.resolve(outcome),
          resolve: () => {}
        }
      }
      for (const previous of currentOperations()) {
        if (
          !previous.transmitted &&
          !previous.outcome &&
          (previous.key === key ||
            (key === 'model' && offers && !offers(previous.key, previous.value)))
        ) {
          settle(previous, { kind: 'superseded' })
        }
      }
      const reply = Promise.withResolvers<SelectionOutcome>()
      const operation: SelectionOperation = {
        identity: ++sequence,
        key,
        value,
        model: key === 'model' ? value : model,
        ...(adoptsModel === false && key !== 'model' ? { adoptsModel } : {}),
        transmitted: false,
        result: reply.promise,
        resolve: reply.resolve
      }
      operation.previousPending = pendingTail
      if (pendingTail) {
        pendingTail.nextPending = operation
      }
      pendingTail = operation
      operations.set(operation.identity, operation)
      latest.set(key, operation.identity)
      // Publish issue facts before subscribers project this pending operation.
      onIssue?.(operation)
      notify()
      return operation
    },
    overlay(): Record<string, string> {
      return Object.fromEntries(
        currentOperations().map((op) => [
          op.key,
          op.outcome?.kind === 'accepted' ? (op.outcome.options[op.key] ?? op.value) : op.value
        ])
      )
    },
    current: (key: string) => operations.get(latest.get(key) ?? -1),
    transmit,
    pending(): SelectionOperation[] {
      return [...operations.values()].filter((op) => !op.outcome)
    },
    isPending: (key: string) => (pendingCounts.get(key) ?? 0) > 0,
    pendingId: () => pendingTail?.key ?? null,
    freeze(replaced: readonly SelectionOperation[] = []): SelectionOperation[] {
      if (!isCurrent()) {
        return []
      }
      // A definitive create refusal permits a new capture; an ambiguous retry never calls freeze.
      for (const op of replaced) {
        if (!op.outcome && operations.get(op.identity) === op) {
          if (latest.get(op.key) === op.identity) {
            if (op.transmitted) {
              pendingCounts.set(op.key, (pendingCounts.get(op.key) ?? 1) - 1)
            }
            op.transmitted = false
          } else {
            settle(op, { kind: 'superseded' })
          }
        }
      }
      const frozen = currentOperations().filter((op) => !op.transmitted && !op.outcome)
      for (const op of frozen) {
        op.transmitted = true
        pendingCounts.set(op.key, (pendingCounts.get(op.key) ?? 0) + 1)
      }
      return frozen
    },
    settle,
    terminalSnapshot: () => (terminal.size ? terminalRevision : 0),
    captureRead(): number[] {
      return [...terminal]
    },
    retire(identities: readonly number[]): void {
      for (const identity of identities) {
        operations.delete(identity)
        terminal.delete(identity)
      }
      if (identities.length) {
        terminalRevision = revision + 1
        notify()
      }
    },
    flush(send: (operation: SelectionOperation) => Promise<SelectionOutcome>): void {
      if (!isCurrent()) {
        return
      }
      const unsent = currentOperations().filter((op) => !op.transmitted && !op.outcome)
      unsent.sort((a, b) => OPTION_ORDER.indexOf(a.key) - OPTION_ORDER.indexOf(b.key))
      for (const operation of unsent) {
        void transmit(operation, send)
      }
    },
    async drain(): Promise<void> {
      while (inFlight.size) {
        await Promise.all(inFlight)
      }
    },
    abandon(): void {
      for (const operation of operations.values()) {
        settle(operation, { kind: 'superseded' })
      }
      operations.clear()
      latest.clear()
      remembered.clear()
      terminal.clear()
      pendingCounts.clear()
      notify()
    }
  }
}
export type StructuredSessionSelectionController = ReturnType<
  typeof createStructuredSessionSelectionController
>
