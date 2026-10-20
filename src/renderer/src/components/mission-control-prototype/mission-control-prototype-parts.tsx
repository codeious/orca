// PROTOTYPE (throwaway): small Mission Control pieces shared by the layout variants.
import React from 'react'
import { CircleDashed, Eye, MessageCircleQuestion, PauseCircle, Rocket, SendHorizontal, SquareTerminal } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import {
  currentMilestone,
  featureCounts,
  visibleActions,
  type ClientKind,
  type MissionActionId,
  type MissionBanner,
  type MissionView
} from './mission-control-prototype-data'

export type PrototypeClient = ClientKind | 'mobile'

export function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
      <span>{children}</span>
      {count !== undefined ? <span className="font-normal tabular-nums">{count}</span> : null}
    </div>
  )
}

export function MissionStateBadge({ view }: { view: MissionView }): React.JSX.Element {
  return (
    <Badge variant="outline" className="gap-1.5">
      <AgentStateDot state={view.stateDot} title={null} />
      {view.stateLabel}
    </Badge>
  )
}

export function VerdictChip({ view }: { view: MissionView }): React.JSX.Element {
  return (
    <Badge variant="hostContext" title="Terminal verdict from the execution host">
      {view.hostLabel} · {view.verdict}
    </Badge>
  )
}

const BANNER_ICON: Record<MissionBanner['tone'], React.ComponentType<{ className?: string }>> = {
  attention: MessageCircleQuestion,
  warning: PauseCircle,
  muted: Eye
}

export function MissionBannerBlock({ view, className }: { view: MissionView; className?: string }): React.JSX.Element | null {
  const banner = view.banner
  if (!banner) {
    return null
  }
  const Icon = view.scenario === 'unverifiable' ? CircleDashed : BANNER_ICON[banner.tone]
  return (
    <div
      data-tone={banner.tone}
      className={cn(
        'flex gap-2.5 rounded-md border border-border px-3 py-2 text-sm',
        banner.tone === 'muted' ? 'bg-muted/40' : 'bg-accent',
        className
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', banner.tone === 'muted' ? 'text-muted-foreground' : 'text-foreground')} />
      <div className="min-w-0 space-y-0.5">
        <div className="font-medium">{banner.title}</div>
        {banner.body ? <div className="text-xs text-muted-foreground">{banner.body}</div> : null}
      </div>
    </div>
  )
}

export function MissionActionButtons({
  view,
  client,
  size = 'sm',
  showHints = true,
  omit,
  className
}: {
  view: MissionView
  client: PrototypeClient
  size?: 'xs' | 'sm' | 'default'
  showHints?: boolean
  omit?: MissionActionId[]
  className?: string
}): React.JSX.Element {
  const actions = visibleActions(view, client).filter((a) => a.id !== 'send' && !omit?.includes(a.id))
  const hints = actions.filter((a) => a.hint)
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) => (
          <Button key={action.id} size={size} variant={action.primary ? 'default' : 'outline'}>
            {action.id === 'openTerminal' ? <SquareTerminal /> : null}
            {action.id === 'start' ? <Rocket /> : null}
            {action.label}
          </Button>
        ))}
      </div>
      {showHints && hints.length > 0 ? (
        <div className="space-y-0.5">
          {hints.map((a) => (
            <div key={a.id} className="text-[11px] text-muted-foreground">
              {a.hint}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function SendMessageBox({ view, className }: { view: MissionView; className?: string }): React.JSX.Element | null {
  if (!view.actions.some((a) => a.id === 'send') || view.readOnly) {
    return null
  }
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Input className="h-8 text-sm" placeholder="Message the Mission" />
      <Button size="icon-sm" variant="outline" aria-label="Send to terminal">
        <SendHorizontal />
      </Button>
    </div>
  )
}

export function MissionProgressLine({ view, className }: { view: MissionView; className?: string }): React.JSX.Element | null {
  if (!view.detailAvailable || view.features.length === 0) {
    return null
  }
  const { done, total } = featureCounts(view)
  const { index, milestone } = currentMilestone(view)
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate">
          <span className="text-muted-foreground">
            Milestone {index + 1} of {view.milestones.length} ·{' '}
          </span>
          {milestone?.title}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {done} of {total} features
        </span>
      </div>
      <Progress value={(done / total) * 100} className="h-1.5" />
    </div>
  )
}

export function MissionFacts({ view, columns = 2 }: { view: MissionView; columns?: 2 | 4 }): React.JSX.Element {
  const facts: [string, string][] = [
    ['Elapsed', view.elapsed],
    ['Credits', view.credits],
    ['Last progress', view.lastProgressAgo],
    ['Last hook', view.lastHookAgo]
  ]
  return (
    <dl className={cn('grid gap-x-4 gap-y-1.5 text-xs', columns === 4 ? 'grid-cols-4' : 'grid-cols-2')}>
      {facts.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="truncate tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function MissionModels({ view }: { view: MissionView }): React.JSX.Element | null {
  if (!view.detailAvailable) {
    return null
  }
  return (
    <div className="text-xs text-muted-foreground">
      Models: orchestrator <span className="text-foreground">{view.models.orchestrator}</span> · worker{' '}
      <span className="text-foreground">{view.models.worker}</span> · validator{' '}
      <span className="text-foreground">{view.models.validator}</span>
      <span className="block text-[11px]">Change them with /missions or /model in the terminal.</span>
    </div>
  )
}

export function MissionEmptyState({ client }: { client: PrototypeClient }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <Rocket className="size-7 text-muted-foreground" />
      <div className="space-y-1">
        <div className="text-sm font-medium">No Mission in this workspace</div>
        <div className="text-xs text-muted-foreground">
          A Mission plans features in milestones and runs Droid workers in a terminal.
        </div>
      </div>
      {client === 'desktop' ? (
        <div className="space-y-1">
          <Button size="sm">
            <Rocket />
            Start Mission
          </Button>
          <div className="text-[11px] text-muted-foreground">Opens a Droid terminal and enters /missions</div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Start a Mission from Orca desktop.</div>
      )}
    </div>
  )
}
