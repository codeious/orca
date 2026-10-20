// PROTOTYPE (throwaway): a static stand-in for Orca's window chrome so variants are judged in context.
// The terminal lines are a rough mock, not a captured Droid transcript.
import React from 'react'
import { CircleCheck, FileText, Files, GitBranch, Plus, Rocket, SquareTerminal } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { ClaudeIcon, DroidIcon } from '@/components/status-bar/icons'
import { cn } from '@/lib/utils'
import type { MissionView } from './mission-control-prototype-data'

function SidebarMock({ view }: { view: MissionView }): React.JSX.Element {
  const childRows = view.workers.filter((w) => !w.ended)
  const showLead = view.scenario !== 'observed'
  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="px-3 pt-3 pb-2 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
        acme-api
      </div>
      <div className="space-y-1 px-2">
        <div className="rounded-md px-2 py-1.5 text-[13px] hover:bg-sidebar-accent">main</div>
        <div data-current="true" className="space-y-1 rounded-md bg-sidebar-accent px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-[13px] font-medium">
            <GitBranch className="size-3.5 text-muted-foreground" />
            rate-limit-api
          </div>
          {showLead ? (
            <div className="space-y-0.5 pl-1">
              <div className="flex items-center gap-1.5 text-[12px]">
                <AgentStateDot state={view.lead.dotState} />
                <DroidIcon size={12} />
                <span className="min-w-0 flex-1 truncate">{view.lead.prompt || 'Droid'}</span>
              </div>
              {view.lead.tool ? (
                <div className="truncate pl-[34px] text-[11px] text-muted-foreground">{view.lead.tool}</div>
              ) : null}
              {view.hasMission ? (
                <div className="ml-[5px] space-y-0.5 border-l border-sidebar-border pl-2">
                  {childRows.map((w) => (
                    <div key={w.id} className={cn('flex items-center gap-1.5 text-[11px]', w.kind === 'subagent' && 'pl-3')}>
                      <AgentStateDot state={w.dotState} />
                      <span className="min-w-0 truncate text-muted-foreground">{w.label}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="space-y-1 rounded-md px-2 py-1.5 hover:bg-sidebar-accent">
          <div className="text-[13px]">fix-login-redirect</div>
          <div className="flex items-center gap-1.5 pl-1 text-[12px]">
            <AgentStateDot state="done" />
            <ClaudeIcon size={12} />
            <span className="truncate text-muted-foreground">Fix the OAuth redirect loop</span>
          </div>
        </div>
      </div>
    </aside>
  )
}

export type FrameTab = 'droid' | 'mission'

function TabBarMock({ view, activeTab, showMissionTab }: { view: MissionView; activeTab: FrameTab; showMissionTab: boolean }): React.JSX.Element {
  const tabClass = (active: boolean): string =>
    cn(
      'flex h-full items-center gap-1.5 border-r border-border px-3 text-[12px]',
      active ? 'bg-background text-foreground' : 'bg-muted/40 text-muted-foreground'
    )
  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-muted/40">
      <div className={tabClass(activeTab === 'droid')}>
        <DroidIcon size={12} />
        Droid
        <AgentStateDot state={view.lead.dotState} />
      </div>
      <div className={tabClass(false)}>
        <FileText className="size-3.5" />
        limiter.ts
      </div>
      {showMissionTab ? (
        <div className={tabClass(activeTab === 'mission')}>
          <Rocket className="size-3.5" />
          Mission
          {view.hasMission ? <AgentStateDot state={view.stateDot} /> : null}
        </div>
      ) : null}
      <div className="flex items-center px-2 text-muted-foreground">
        <Plus className="size-3.5" />
      </div>
    </div>
  )
}

function ActivityBarMock({ missionActive }: { missionActive: boolean }): React.JSX.Element {
  const items = [
    { id: 'files', Icon: Files },
    { id: 'scm', Icon: GitBranch },
    { id: 'checks', Icon: CircleCheck },
    { id: 'mission', Icon: Rocket }
  ]
  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-border py-2">
      {items.map(({ id, Icon }) => (
        <div
          key={id}
          title={id === 'mission' ? 'Mission Control' : undefined}
          className={cn(
            'flex size-8 items-center justify-center rounded-md text-muted-foreground',
            id === 'mission' && missionActive && 'bg-accent text-foreground'
          )}
        >
          <Icon className="size-4" />
        </div>
      ))}
    </div>
  )
}

const TERMINAL_LINES: Record<string, string[]> = {
  none: ['droid v0.244.0 · acme-api', '', '> '],
  planning: [
    '> /missions',
    'Mission planning · Rate-limit the public API',
    '',
    '? Which store should back the limiter?',
    '  1. Redis (shared across instances)',
    '  2. In-memory only',
    '> '
  ],
  approval: [
    'Proposed Mission · 3 milestones · 9 features',
    '  1. Limiter core (3)',
    '  2. Middleware and config (4)',
    '  3. Docs and rollout (2)',
    '',
    'Approve this plan? (y) approve  (e) edit  (n) cancel'
  ],
  running: [
    'Mission · Rate-limit the public API',
    '⏺ StartMissionRun  running',
    '  ✓ Limiter core validated',
    '  ✓ Per-route limits in config  (try 2)',
    '  ● Express middleware  6m',
    '',
    '> '
  ],
  interrupted: ['● Express middleware  6m', '', '[process exited]', '$ '],
  observed: ['$ '],
  completed: ['✓ Mission completed · 9 of 9 features', '', '> ']
}

export function TerminalMock({ view, className }: { view: MissionView; className?: string }): React.JSX.Element {
  const lines = TERMINAL_LINES[view.scenario] ?? TERMINAL_LINES.running
  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-hidden bg-editor-surface p-3 font-mono text-[12px] leading-5 whitespace-pre text-foreground/85',
        view.scenario === 'unverifiable' && 'opacity-60',
        className
      )}
    >
      {lines.map((line, i) => (
        <div key={i}>{line || ' '}</div>
      ))}
    </div>
  )
}

export function DesktopFrame({
  view,
  activeTab = 'droid',
  showMissionTab = false,
  rightPanel,
  children
}: {
  view: MissionView
  activeTab?: FrameTab
  showMissionTab?: boolean
  rightPanel?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-3 text-[12px]">
        <div className="flex w-[64px] gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-3 rounded-full bg-muted-foreground/30" />
          ))}
        </div>
        <SquareTerminal className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">acme-api /</span>
        <span>rate-limit-api</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <SidebarMock view={view} />
        <main className="flex min-w-0 flex-1 flex-col">
          <TabBarMock view={view} activeTab={activeTab} showMissionTab={showMissionTab} />
          <div className="flex min-h-0 flex-1">{children}</div>
        </main>
        {rightPanel ? (
          <aside className="flex w-[344px] shrink-0 flex-col border-l border-border bg-background">{rightPanel}</aside>
        ) : null}
        <ActivityBarMock missionActive={Boolean(rightPanel)} />
      </div>
    </div>
  )
}
