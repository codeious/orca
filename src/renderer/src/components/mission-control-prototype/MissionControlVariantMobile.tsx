// PROTOTYPE (throwaway): variants D and E, Mission Control on the mobile app (HTML stand-in for React Native).
import React, { useState } from 'react'
import { ChevronLeft, ChevronRight, Rocket } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { ClaudeIcon, DroidIcon } from '@/components/status-bar/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TerminalMock } from './MissionControlPrototypeFrame'
import { featureCounts, type MissionView } from './mission-control-prototype-data'
import { MilestoneList, ProgressLog, WorkerDetail, WorkerList } from './mission-control-prototype-lists'
import {
  MissionActionButtons,
  MissionBannerBlock,
  MissionEmptyState,
  MissionFacts,
  MissionProgressLine,
  MissionStateBadge,
  SendMessageBox,
  VerdictChip
} from './mission-control-prototype-parts'

function Phone({ caption, children }: { caption: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="text-center text-xs text-muted-foreground">{caption}</div>
      <div className="dark">
        <div className="relative flex h-[844px] w-[390px] flex-col overflow-hidden rounded-[2rem] border border-border bg-background text-foreground shadow-floating">
          <div className="flex h-11 shrink-0 items-center px-6 text-xs font-semibold">9:41</div>
          {children}
        </div>
      </div>
    </div>
  )
}

function MobileHeader({ title, sub }: { title: string; sub?: string }): React.JSX.Element {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      <ChevronLeft className="size-5 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{title}</div>
        {sub ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
      </div>
    </div>
  )
}

function MissionDetailTabs({ view, defaultTab }: { view: MissionView; defaultTab: string }): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = view.workers.find((w) => w.id === selectedId) ?? null
  return (
    <Tabs defaultValue={defaultTab} className="min-h-0 flex-1 gap-3">
      <TabsList className="w-full">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="plan">Plan</TabsTrigger>
        <TabsTrigger value="workers">Workers</TabsTrigger>
        <TabsTrigger value="log">Log</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="space-y-3">
        <MissionBannerBlock view={view} />
        <MissionProgressLine view={view} />
        <MissionFacts view={view} />
      </TabsContent>
      <TabsContent value="plan">
        {view.detailAvailable ? <MilestoneList view={view} /> : <div className="text-xs text-muted-foreground">Needs Mission detail from the host.</div>}
      </TabsContent>
      <TabsContent value="workers" className="space-y-3">
        <WorkerList view={view} selectedId={selectedId} onSelect={setSelectedId} showModel={false} />
        {selected && view.detailAvailable ? (
          <div className="rounded-xl border border-border p-3">
            <WorkerDetail view={view} worker={selected} client="mobile" />
          </div>
        ) : null}
      </TabsContent>
      <TabsContent value="log">
        <ProgressLog entries={view.progress} />
      </TabsContent>
    </Tabs>
  )
}

function MissionCard({ view }: { view: MissionView }): React.JSX.Element {
  const running = view.workers.find((w) => !w.ended && w.kind !== 'subagent')
  return (
    <div className="mx-3 my-2 space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Rocket className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{view.title}</span>
        <MissionStateBadge view={view} />
      </div>
      {view.banner ? <div className="text-xs">{view.banner.title}</div> : null}
      <MissionProgressLine view={view} />
      {running ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AgentStateDot state={running.dotState} />
          <span className="truncate">{running.label}</span>
          <span className="ml-auto">{running.started}</span>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <MissionActionButtons view={view} client="mobile" size="xs" showHints={false} omit={['openTerminal']} />
        <Button size="xs" variant="ghost">
          Details
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}

function SessionScreen({ view, children }: { view: MissionView; children?: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <MobileHeader title="rate-limit-api" sub={`acme-api · ${view.hostLabel}`} />
      <div className="flex shrink-0 gap-1.5 border-b border-border px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1">
          <DroidIcon size={11} />
          Droid
          <AgentStateDot state={view.lead.dotState} />
        </span>
        <span className="rounded-full px-2.5 py-1 text-muted-foreground">zsh</span>
      </div>
      {view.hasMission ? <MissionCard view={view} /> : null}
      <TerminalMock view={view} className="text-[11px]" />
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
        <Input className="h-9" placeholder="Type into the terminal" />
      </div>
      {children}
    </>
  )
}

export function MissionControlVariantMobileCard({ view }: { view: MissionView }): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-start justify-center gap-10 bg-muted p-8 pb-20">
      <Phone caption="Session screen: Mission card above the terminal">
        <SessionScreen view={view} />
      </Phone>
      <Phone caption="Tap Details: Mission sheet over the session">
        <SessionScreen view={view}>
          <div className="absolute inset-0 top-11 bg-background/60" />
          <div className="absolute inset-x-0 bottom-0 flex h-[76%] flex-col gap-3 rounded-t-2xl border-t border-border bg-background px-4 pt-2 pb-4">
            <div className="mx-auto h-1 w-9 rounded-full bg-muted-foreground/40" />
            {view.hasMission ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[15px] font-semibold">{view.title}</span>
                  <MissionStateBadge view={view} />
                  <VerdictChip view={view} />
                </div>
                <MissionDetailTabs key={view.scenario} view={view} defaultTab="overview" />
                <SendMessageBox view={view} />
                <MissionActionButtons view={view} client="mobile" />
              </>
            ) : (
              <MissionEmptyState client="mobile" />
            )}
          </div>
        </SessionScreen>
      </Phone>
    </div>
  )
}

function WorktreeRow({ name, children }: { name: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-1.5 border-b border-border px-4 py-3">
      <div className="text-sm font-medium">{name}</div>
      {children}
    </div>
  )
}

export function MissionControlVariantMobileScreen({ view }: { view: MissionView }): React.JSX.Element {
  const { done, total } = featureCounts(view)
  return (
    <div className="flex min-h-screen items-start justify-center gap-10 bg-muted p-8 pb-20">
      <Phone caption="Worktree list: Mission line on the row">
        <MobileHeader title="acme-api" sub={view.hostLabel} />
        <WorktreeRow name="main">
          <div className="text-xs text-muted-foreground">No agents</div>
        </WorktreeRow>
        <WorktreeRow name="rate-limit-api">
          <div className="flex items-center gap-1.5 text-xs">
            <AgentStateDot state={view.lead.dotState} />
            <DroidIcon size={12} />
            <span className="text-muted-foreground">+{view.workers.filter((w) => !w.ended).length} workers</span>
          </div>
          {view.hasMission ? (
            <div className="flex items-center gap-2 rounded-lg bg-accent px-2.5 py-2 text-xs">
              <Rocket className="size-3.5 text-muted-foreground" />
              <span className="font-medium">Mission</span>
              <span className="text-muted-foreground">
                {view.stateLabel}
                {total > 0 ? ` · ${done}/${total}` : ''}
              </span>
              <ChevronRight className="ml-auto size-4 text-muted-foreground" />
            </div>
          ) : null}
        </WorktreeRow>
        <WorktreeRow name="fix-login-redirect">
          <div className="flex items-center gap-1.5 text-xs">
            <AgentStateDot state="done" />
            <ClaudeIcon size={12} />
          </div>
        </WorktreeRow>
      </Phone>
      <Phone caption="Mission screen (own route)">
        <MobileHeader title="Mission" sub="rate-limit-api" />
        {view.hasMission ? (
          <>
            <div className="scrollbar-sleek min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="space-y-1.5">
                <div className="text-[15px] font-semibold">{view.title}</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <MissionStateBadge view={view} />
                  <VerdictChip view={view} />
                </div>
              </div>
              <MissionDetailTabs key={view.scenario} view={view} defaultTab="plan" />
            </div>
            <div className="shrink-0 space-y-2 border-t border-border px-4 py-3">
              <SendMessageBox view={view} />
              <MissionActionButtons view={view} client="mobile" />
            </div>
          </>
        ) : (
          <MissionEmptyState client="mobile" />
        )}
      </Phone>
    </div>
  )
}
