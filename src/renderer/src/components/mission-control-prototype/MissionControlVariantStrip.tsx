// PROTOTYPE (throwaway): variant C, a Mission strip on the Droid terminal pane that drops details over it.
import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Rocket } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { DesktopFrame, TerminalMock } from './MissionControlPrototypeFrame'
import { currentMilestone, featureCounts, type ClientKind, type MissionView } from './mission-control-prototype-data'
import { MilestoneList, ProgressLog, WorkerDetail, WorkerList } from './mission-control-prototype-lists'
import { MissionActionButtons, MissionFacts, MissionStateBadge, SectionLabel } from './mission-control-prototype-parts'

function MissionStrip({ view, client, open, onToggle }: { view: MissionView; client: ClientKind; open: boolean; onToggle: () => void }): React.JSX.Element {
  const { done, total } = featureCounts(view)
  const { index } = currentMilestone(view)
  return (
    <div className="shrink-0 border-b border-border bg-muted/40">
      <div className="flex h-9 items-center gap-2.5 px-3 text-[12px]">
        <Rocket className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium">{view.title}</span>
        <span className="shrink-0">
          <MissionStateBadge view={view} />
        </span>
        {view.detailAvailable && total > 0 ? (
          <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground tabular-nums">
            <Progress value={(done / total) * 100} className="h-1.5 w-16" />
            M{index + 1} · {done}/{total}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-muted-foreground">{view.lastProgressAgo}</span>
        {/* The strip sits on the terminal, so "Open terminal" would be a no-op here. */}
        <MissionActionButtons view={view} client={client} size="xs" showHints={false} omit={['openTerminal']} />
        <Button size="xs" variant="ghost" onClick={onToggle} aria-expanded={open}>
          Details
          {open ? <ChevronUp /> : <ChevronDown />}
        </Button>
      </div>
      {view.banner ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-1 text-[12px]">
          <AgentStateDot state={view.stateDot} title={null} />
          <span className="font-medium">{view.banner.title}</span>
          {view.banner.body ? <span className="truncate text-muted-foreground">{view.banner.body}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

function MissionBoard({ view, client }: { view: MissionView; client: ClientKind }): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(view.workers[0]?.id ?? null)
  const selected = view.workers.find((w) => w.id === selectedId) ?? null
  // Overlay rather than push-down so opening details never resizes the PTY under the Droid TUI.
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-[72%] border-b border-border bg-background shadow-floating">
      <div className="scrollbar-sleek min-w-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        <SectionLabel count={view.features.length || undefined}>Plan</SectionLabel>
        {view.detailAvailable ? <MilestoneList view={view} /> : <div className="text-xs text-muted-foreground">Features and milestones need Mission detail.</div>}
      </div>
      <div className="scrollbar-sleek w-[300px] shrink-0 space-y-3 overflow-y-auto border-l border-border p-3">
        <SectionLabel count={view.workers.length || undefined}>Workers</SectionLabel>
        <WorkerList view={view} selectedId={selectedId} onSelect={setSelectedId} showModel={false} finishedLimit={2} />
        {selected && view.detailAvailable ? (
          <div className="border-t border-border pt-3">
            <WorkerDetail view={view} worker={selected} client={client} />
          </div>
        ) : null}
        <div className="space-y-1.5 border-t border-border pt-3">
          <SectionLabel>Progress</SectionLabel>
          <ProgressLog entries={view.progress} limit={3} />
        </div>
        <div className="border-t border-border pt-3">
          <MissionFacts view={view} />
        </div>
      </div>
    </div>
  )
}

export function MissionControlVariantStrip({ view, client, initiallyOpen }: { view: MissionView; client: ClientKind; initiallyOpen: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <DesktopFrame view={view}>
      <div className="flex min-w-0 flex-[3] flex-col">
        {view.hasMission ? (
          <MissionStrip view={view} client={client} open={open} onToggle={() => setOpen((o) => !o)} />
        ) : (
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 text-[12px] text-muted-foreground">
            <Rocket className="size-3.5" />
            No Mission in this terminal
            {client === 'desktop' ? (
              <Button size="xs" variant="outline" className="ml-auto">
                Start Mission
              </Button>
            ) : null}
          </div>
        )}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {open && view.hasMission ? <MissionBoard key={view.scenario} view={view} client={client} /> : null}
          <TerminalMock view={view} />
          <div className={cn('border-t border-border px-3 py-1 text-[11px] text-muted-foreground', !view.hasMission && 'hidden')}>
            To steer the Mission, type in this terminal.
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-[2] flex-col border-l border-border">
        <div className="flex h-9 shrink-0 items-center border-b border-border px-3 text-[12px] text-muted-foreground">zsh</div>
        <div className="flex-1 bg-editor-surface p-3 font-mono text-[12px] leading-5 text-foreground/85">$ pnpm test --watch</div>
      </div>
    </DesktopFrame>
  )
}
