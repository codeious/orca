import {
  DROID_AUTONOMY_OPTION_ID,
  type DroidAutonomyLevel
} from '../../shared/droid-autonomy-options'
import type { DroidSession, DroidSessionDeps } from './droid-session'
import type { DroidInteractionMode, DroidReportedSettings } from './droid-session-settings'

export class DroidSessionModeReports {
  private ready = false
  private approvedAutonomy: DroidAutonomyLevel | null | undefined

  constructor(
    private readonly session: Pick<
      DroidSession,
      'input' | 'generation' | 'settings' | 'model' | 'options'
    >,
    private readonly requested: DroidInteractionMode,
    private readonly publish: DroidSessionDeps['onLifecycle']
  ) {}

  opened(): void {
    this.ready = true
  }

  planApproved = (level: DroidAutonomyLevel | null): void => {
    this.approvedAutonomy = level
  }

  receive = (report: Parameters<DroidReportedSettings['receive']>[0]): void => {
    const { settings, model, options, input, generation } = this.session
    const before = settings.current.interactionMode ?? this.requested
    settings.receive(report)
    const after = settings.current.interactionMode ?? this.requested
    if (!this.ready || before === after) {
      return
    }
    const level = before === 'spec' && after === 'auto' ? this.approvedAutonomy : undefined
    this.approvedAutonomy = undefined
    if (level) {
      options.noteChosenAutonomy(level)
    }
    const planMode = after === 'spec'
    this.publish({
      type: 'options-reported',
      sessionId: input.identity.sessionId,
      fence: input.fence,
      acquisitionGeneration: generation,
      reportedOptions: { ...model.current, planMode },
      providerPicks: {
        planMode: String(planMode),
        ...(level ? { [DROID_AUTONOMY_OPTION_ID]: level } : {})
      }
    })
  }
}
