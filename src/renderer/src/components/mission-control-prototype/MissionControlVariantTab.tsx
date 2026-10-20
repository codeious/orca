// PROTOTYPE (throwaway): variant B, Mission Control as its own workspace tab with a full dashboard.
import React, { useState } from 'react'
import { CircleCheck, Rocket, SquareTerminal } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DesktopFrame } from './MissionControlPrototypeFrame'
import { FEATURE_STATUS_LABEL, featureDot, type ClientKind, type MissionView } from './mission-control-prototype-data'
import { ProgressLog, WorkerDetail, WorkerList } from './mission-control-prototype-lists'
import {
  MissionActionButtons,
  MissionBannerBlock,
  MissionEmptyState,
  MissionFacts,
  MissionModels,
  MissionProgressLine,
  MissionStateBadge,
  SectionLabel,
  SendMessageBox,
  VerdictChip
} from './mission-control-prototype-parts'

function MilestoneStepper({ view }: { view: MissionView }): React.JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-2">
      {view.milestones.map((m, i) => {
        const features = view.features.filter((f) => f.milestoneId === m.id)
        const done = features.filter((f) => f.status === 'completed').length
        const active = !m.validated && view.milestones.slice(0, i).every((p) => p.validated)
        return (
          <div
            key={m.id}
            data-current={active ? 'true' : undefined}
            className="space-y-1 rounded-md border border-border px-3 py-2 data-[current=true]:border-ring"
          >
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {m.validated ? <CircleCheck className="size-3" /> : null}
              Milestone {i + 1}
              {m.validated ? ' · validated' : active ? ' · in progress' : ''}
            </div>
            <div className="truncate text-[13px] font-medium">{m.title}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums">
              {done} of {features.length} features
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FeatureTable({ view }: { view: MissionView }): React.JSX.Element {
  const milestoneTitle = (id: string): string => view.milestones.find((m) => m.id === id)?.title ?? ''
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
          <th className="py-1.5 pr-2 font-medium">Feature</th>
          <th className="py-1.5 pr-2 font-medium">Milestone</th>
          <th className="py-1.5 pr-2 font-medium">Status</th>
          <th className="py-1.5 text-right font-medium">Tries</th>
        </tr>
      </thead>
      <tbody>
        {view.features.map((f) => (
          <tr key={f.id} className="border-b border-border/60 hover:bg-accent">
            <td className={cn('py-1.5 pr-2', f.status === 'pending' && 'text-muted-foreground')}>{f.title}</td>
            <td className="py-1.5 pr-2 text-muted-foreground">{milestoneTitle(f.milestoneId)}</td>
            <td className="py-1.5 pr-2">
              <span className="inline-flex items-center gap-1.5">
                <AgentStateDot state={featureDot(f.status)} title={null} />
                {FEATURE_STATUS_LABEL[f.status]}
              </span>
            </td>
            <td className="py-1.5 text-right text-muted-foreground tabular-nums">{f.attempts || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MissionDashboard({ view, client }: { view: MissionView; client: ClientKind }): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(view.workers[0]?.id ?? null)
  const selected = view.workers.find((w) => w.id === selectedId) ?? null
  if (!view.hasMission) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <MissionEmptyState client={client} />
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="space-y-3 border-b border-border px-6 py-4">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <Rocket className="size-4 text-muted-foreground" />
              <h1 className="truncate text-base font-semibold">{view.title}</h1>
              <MissionStateBadge view={view} />
              <VerdictChip view={view} />
            </div>
            <div className="text-xs text-muted-foreground">{view.phase}</div>
          </div>
          <MissionActionButtons view={view} client={client} className="max-w-[340px]" />
        </div>
        <MissionBannerBlock view={view} />
        <div className="grid grid-cols-[1fr_auto] items-end gap-6">
          <MissionProgressLine view={view} />
          <div className="w-[360px]">
            <MissionFacts view={view} columns={4} />
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-sleek min-w-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {view.detailAvailable ? (
            <>
              <section className="space-y-2">
                <SectionLabel>Milestones</SectionLabel>
                {view.milestones.length > 0 ? (
                  <MilestoneStepper view={view} />
                ) : (
                  <div className="text-xs text-muted-foreground">No plan in the Mission files yet.</div>
                )}
              </section>
              {view.features.length > 0 ? (
                <section className="space-y-2">
                  <SectionLabel count={view.features.length}>Features</SectionLabel>
                  <FeatureTable view={view} />
                </section>
              ) : null}
              <MissionModels view={view} />
            </>
          ) : (
            <div className="text-xs text-muted-foreground">Features and milestones need Mission detail.</div>
          )}
        </div>
        <div className="scrollbar-sleek flex w-[380px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border p-4">
          <section className="space-y-1.5">
            <SectionLabel count={view.workers.length || undefined}>Workers</SectionLabel>
            <WorkerList view={view} selectedId={selectedId} onSelect={setSelectedId} />
          </section>
          {selected && view.detailAvailable ? (
            <section className="border-t border-border pt-3">
              <WorkerDetail view={view} worker={selected} client={client} />
            </section>
          ) : null}
          {view.detailAvailable ? (
            <section className="space-y-1.5 border-t border-border pt-3">
              <SectionLabel>Progress</SectionLabel>
              <ProgressLog entries={view.progress} limit={6} />
            </section>
          ) : null}
        </div>
      </div>
      <footer className="flex items-center gap-3 border-t border-border px-6 py-2">
        <SendMessageBox view={view} className="flex-1" />
        <Button size="sm" variant="ghost">
          <SquareTerminal />
          Go to terminal
        </Button>
      </footer>
    </div>
  )
}

export function MissionControlVariantTab({ view, client }: { view: MissionView; client: ClientKind }): React.JSX.Element {
  return (
    <DesktopFrame view={view} activeTab="mission" showMissionTab>
      <MissionDashboard key={view.scenario} view={view} client={client} />
    </DesktopFrame>
  )
}
