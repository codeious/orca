import { isPlanApprovalSubject } from '../../shared/agent-session/agent-session-approval-subject'
import {
  isValidAgentSessionQuestionAnswers,
  legacyAgentSessionQuestionAnswers,
  type AgentSessionPromptResponse
} from '../../shared/agent-session/agent-session-question-answer'
import { DROID_AUTONOMY_LEVELS, type DroidAutonomyLevel } from '../../shared/droid-autonomy-options'
import { truncateToolDetail } from '../../shared/native-chat/tools/native-chat-tool-summary'
import { boundJournalPromptBody } from '../native-chat/agent-session-journal/journal-prompt-body-bounds'
import {
  pendingDroidResolution,
  type DroidPromptEnvironment,
  type DroidPromptPresentation
} from './droid-prompt-presentation'
import { droidAutonomyChoices } from './droid-session-option-descriptors'
import { startsDroidSpecHandoff } from './droid-spec-handoff'

type PlanReview = {
  plan?: string
  title?: string
  supportsClientStartedHandoff?: boolean
  detail: string
  decisionReason?: string
}
type PlanResponse = Extract<AgentSessionPromptResponse, { kind: 'option' }>

function planOption(action: string, level: DroidAutonomyLevel): string {
  return level === 'off'
    ? action
    : `${action === 'proceed_once' ? 'proceed_auto_run' : action}_${level}`
}

export function droidPlanApprovalPresentation(
  plan: PlanReview,
  offered: readonly { value: string }[],
  environment: DroidPromptEnvironment
): DroidPromptPresentation {
  const takesNotes = plan.supportsClientStartedHandoff === true
  const handsOff = takesNotes && environment.beginSpecHandoff !== undefined
  const reported = environment.autonomyLevels() ?? ['off']
  const levelsFor = (action: string) =>
    DROID_AUTONOMY_LEVELS.filter(
      (level) =>
        reported.includes(level) && offered.some(({ value }) => value === planOption(action, level))
    )
  const options = [
    { id: 'proceed_once', label: 'Proceed with implementation' },
    ...(handsOff ? [{ id: 'proceed_new_session', label: 'Proceed in a new session' }] : [])
  ].filter(({ id }) => levelsFor(id).length > 0)
  if (offered.some(({ value }) => value === 'cancel')) {
    options.push({ id: 'cancel', label: 'No, keep iterating on spec' })
  }
  const bounded = boundJournalPromptBody({
    kind: 'approval',
    title: 'Review proposed plan',
    ...(plan.title ? { description: plan.title } : {}),
    ...(plan.decisionReason ? { decisionReason: plan.decisionReason } : {}),
    ...(plan.plan ? { subject: { kind: 'plan', text: plan.plan } } : {}),
    detail: truncateToolDetail(plan.plan ?? plan.detail) || null,
    options,
    resolution: pendingDroidResolution
  })
  const choose = (response: AgentSessionPromptResponse): PlanResponse => {
    if (response.kind !== 'option' || !options.some(({ id }) => id === response.optionId)) {
      throw new Error('Choose one of the options Droid offered')
    }
    return response
  }
  let approvedLevel: DroidAutonomyLevel | null | undefined
  const replied = () => {
    if (approvedLevel !== undefined) {
      environment.planApproved?.(approvedLevel)
    }
  }
  const reply = (
    selectedOption: string,
    response?: PlanResponse,
    operationId?: string,
    level?: DroidAutonomyLevel
  ) => {
    const handoff = startsDroidSpecHandoff(selectedOption)
    if (handoff && !operationId) {
      throw new Error('A plan handoff requires a host operation ID')
    }
    approvedLevel = selectedOption !== 'cancel' && !handoff ? (level ?? null) : undefined
    return {
      selectedOption,
      ...(handoff && operationId
        ? {
            clientStartsHandoffSession: true,
            specHandoffId: environment.beginSpecHandoff?.(selectedOption, operationId)
          }
        : {}),
      ...(takesNotes && response?.comment?.trim() ? { comment: response.comment } : {}),
      ...(takesNotes && response?.editedSpecContent?.trim()
        ? { editedSpecContent: response.editedSpecContent }
        : {})
    }
  }
  return {
    replied,
    body: takesNotes
      ? {
          ...bounded,
          acceptsComment: true,
          ...(isPlanApprovalSubject(bounded.subject) && bounded.subject.text === plan.plan
            ? { acceptsPlanEdit: true }
            : {})
        }
      : bounded,
    advance: (response) => {
      const chosen = choose(response)
      if (chosen.optionId === 'cancel') {
        return null
      }
      const levels = levelsFor(chosen.optionId)
      if (levels.length === 1 && levels[0] === 'off') {
        return null
      }
      const current = environment.autonomyLevel()
      const question = {
        id: 'q1',
        question: 'Permissions',
        multiSelect: false,
        options: levels.map((level) => ({
          id: level,
          label: `${droidAutonomyChoices[level].label}${level === current ? ' (current)' : ''}`,
          description: droidAutonomyChoices[level].description
        }))
      }
      const body = boundJournalPromptBody({
        kind: 'question',
        question: question.question,
        options: question.options,
        questions: [question],
        resolution: pendingDroidResolution
      })
      return {
        body,
        replied,
        reply: (answer, operationId) => {
          if (answer === null) {
            return reply('cancel')
          }
          const answers =
            answer.kind === 'answers'
              ? answer.answers
              : legacyAgentSessionQuestionAnswers(body, answer.optionId)
          if (!answers || !isValidAgentSessionQuestionAnswers([question], answers)) {
            throw new Error('Choose one of the permissions Droid offered')
          }
          const level = levels.find((level) => level === answers[0]?.optionIds[0])
          if (!level) {
            throw new Error('Choose one of the permissions Droid offered')
          }
          return reply(planOption(chosen.optionId, level), chosen, operationId, level)
        }
      }
    },
    reply: (response, operationId) => {
      if (response === null) {
        return reply('cancel')
      }
      const chosen = choose(response)
      if (
        chosen.optionId !== 'cancel' &&
        levelsFor(chosen.optionId).some((level) => level !== 'off')
      ) {
        throw new Error('Choose permissions before proceeding')
      }
      return reply(chosen.optionId, chosen, operationId)
    }
  }
}
