// PROTOTYPE (throwaway): Mission Control lists (milestones, features, workers, log) shared by variants.
import React from 'react'
import { CircleCheck, FileText } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  FEATURE_STATUS_LABEL,
  featureDot,
  type MissionFeature,
  type MissionView,
  type MissionWorker,
  type ProgressEntry
} from './mission-control-prototype-data'
import type { PrototypeClient } from './mission-control-prototype-parts'

export function FeatureRow({ feature, dense = false }: { feature: MissionFeature; dense?: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex items-center gap-2 rounded-md px-2 text-[13px] hover:bg-accent', dense ? 'py-0.5' : 'py-1')}>
      <AgentStateDot state={featureDot(feature.status)} title={FEATURE_STATUS_LABEL[feature.status]} />
      <span className={cn('min-w-0 flex-1 truncate', feature.status === 'pending' && 'text-muted-foreground')}>
        {feature.title}
      </span>
      {feature.attempts > 1 ? (
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">try {feature.attempts}</span>
      ) : null}
    </div>
  )
}

export function MilestoneList({ view, showFeatures = true }: { view: MissionView; showFeatures?: boolean }): React.JSX.Element {
  if (view.milestones.length === 0) {
    return <div className="px-2 py-1 text-xs text-muted-foreground">No plan in the Mission files yet.</div>
  }
  return (
    <div className="space-y-2">
      {view.milestones.map((milestone, i) => {
        const features = view.features.filter((f) => f.milestoneId === milestone.id)
        const done = features.filter((f) => f.status === 'completed').length
        return (
          <div key={milestone.id} className="space-y-0.5">
            <div className="flex items-center gap-2 px-2 text-[13px] font-medium">
              {milestone.validated ? (
                <CircleCheck className="size-3.5 text-muted-foreground" />
              ) : (
                <span className="flex size-3.5 items-center justify-center text-[11px] text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{milestone.title}</span>
              <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
                {done}/{features.length}
                {milestone.validated ? ' · validated' : ''}
              </span>
            </div>
            {showFeatures ? (
              <div className="ml-3 border-l border-border pl-1">
                {features.map((f) => (
                  <FeatureRow key={f.id} feature={f} dense />
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

const KIND_LABEL: Record<MissionWorker['kind'], string> = {
  worker: 'Worker',
  validator: 'Validator',
  subagent: 'Subagent'
}

export function WorkerRow({
  worker,
  selected,
  onSelect,
  showModel = true
}: {
  worker: MissionWorker
  selected?: boolean
  onSelect?: (id: string) => void
  showModel?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-current={selected ? 'true' : undefined}
      onClick={() => onSelect?.(worker.id)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent data-[current=true]:bg-accent',
        worker.kind === 'subagent' && 'pl-6'
      )}
    >
      <AgentStateDot state={worker.dotState} />
      <span className="min-w-0 flex-1 truncate">
        {worker.label}
        <span className="text-muted-foreground"> · {KIND_LABEL[worker.kind]}</span>
      </span>
      {showModel ? <span className="shrink-0 text-[11px] text-muted-foreground">{worker.model}</span> : null}
      <span className="w-14 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
        {worker.ended ?? worker.started}
      </span>
    </button>
  )
}

export function WorkerList({
  view,
  selectedId,
  onSelect,
  showModel = true,
  finishedLimit
}: {
  view: MissionView
  selectedId?: string | null
  onSelect?: (id: string) => void
  showModel?: boolean
  finishedLimit?: number
}): React.JSX.Element {
  const running = view.workers.filter((w) => !w.ended)
  const finished = view.workers.filter((w) => w.ended)
  const shownFinished = finishedLimit === undefined ? finished : finished.slice(0, finishedLimit)
  if (view.workers.length === 0) {
    return <div className="px-2 py-1 text-xs text-muted-foreground">No workers yet.</div>
  }
  return (
    <div className="space-y-0.5">
      {running.map((w) => (
        <WorkerRow key={w.id} worker={w} selected={selectedId === w.id} onSelect={onSelect} showModel={showModel} />
      ))}
      {running.length > 0 && finished.length > 0 ? <div className="mx-2 my-1 border-t border-border" /> : null}
      {shownFinished.map((w) => (
        <WorkerRow key={w.id} worker={w} selected={selectedId === w.id} onSelect={onSelect} showModel={showModel} />
      ))}
      {shownFinished.length < finished.length ? (
        <div className="px-2 py-0.5 text-[11px] text-muted-foreground">
          {finished.length - shownFinished.length} more finished
        </div>
      ) : null}
    </div>
  )
}

export function WorkerDetail({
  view,
  worker,
  client
}: {
  view: MissionView
  worker: MissionWorker
  client: PrototypeClient
}): React.JSX.Element {
  const feature = view.features.find((f) => f.id === worker.featureId)
  const rows: [string, string][] = [
    ['Feature', feature?.title ?? (worker.kind === 'validator' ? 'Milestone review' : '—')],
    ['Status', feature ? FEATURE_STATUS_LABEL[feature.status] : '—'],
    ['Model', worker.model],
    ['Started', worker.started],
    ['Ended', worker.ended ?? '—'],
    ['Result', worker.successState ?? '—'],
    ['Session', worker.sessionId]
  ]
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AgentStateDot state={worker.dotState} size="md" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{worker.label}</div>
        <Badge variant="outline">{KIND_LABEL[worker.kind]}</Badge>
      </div>
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {worker.handoff ? (
        <div className="space-y-1 text-xs">
          <div className="text-muted-foreground">Handoff</div>
          <div>{worker.handoff.summary}</div>
          {worker.handoff.discoveredIssues.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              {worker.handoff.discoveredIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {client === 'desktop' ? (
        <Button size="xs" variant="outline">
          <FileText />
          Load transcript tail
        </Button>
      ) : (
        <div className="text-[11px] text-muted-foreground">The transcript tail is on Orca desktop.</div>
      )}
      <div className="text-[11px] text-muted-foreground">Read-only. Steer the Mission from its terminal.</div>
    </div>
  )
}

export function ProgressLog({ entries, limit }: { entries: ProgressEntry[]; limit?: number }): React.JSX.Element {
  const shown = limit === undefined ? entries : entries.slice(0, limit)
  if (shown.length === 0) {
    return <div className="px-2 py-1 text-xs text-muted-foreground">No progress yet.</div>
  }
  return (
    <ol className="space-y-1">
      {shown.map((entry) => (
        <li key={`${entry.ago}-${entry.text}`} className="flex gap-2 px-2 text-xs">
          <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">{entry.ago}</span>
          <span className="min-w-0 flex-1">{entry.text}</span>
        </li>
      ))}
    </ol>
  )
}
