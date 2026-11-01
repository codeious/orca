import { toast } from 'sonner'
import { unsupportedAgentVersionReceiptDetail } from '../../../shared/unsupported-agent-version'

/** One notice per agent for the life of this renderer. A relaunch starts a new run. */
const toastedAgents = new Set<string>()

export function toastUnsupportedAgentVersionOnce(agent: string, detail: string): void {
  const sentence = detail.trim()
  if (!sentence || toastedAgents.has(agent)) {
    return
  }
  toastedAgents.add(agent)
  toast.info(sentence)
}

/** A host `agent.launch` receipt, when this reason is why the terminal opened. */
export function toastAgentLaunchVersionReceipt(agent: string, result: unknown): void {
  const detail = unsupportedAgentVersionReceiptDetail(result)
  if (detail) {
    toastUnsupportedAgentVersionOnce(agent, detail)
  }
}

export function resetUnsupportedAgentVersionToastsForTests(): void {
  toastedAgents.clear()
}
