// PROTOTYPE (throwaway): variant A, Mission Control as a right sidebar panel beside the live terminal.
import React, { useState } from 'react'
import { DesktopFrame, TerminalMock } from './MissionControlPrototypeFrame'
import type { ClientKind, MissionView } from './mission-control-prototype-data'
import { MilestoneList, ProgressLog, WorkerDetail, WorkerList } from './mission-control-prototype-lists'
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

function SidebarPanel({ view, client }: { view: MissionView; client: ClientKind }): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(view.workers[0]?.id ?? null)
  const selected = view.workers.find((w) => w.id === selectedId) ?? null
  return (
    <>
      <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
        <SectionLabel>Mission Control</SectionLabel>
      </div>
      {view.hasMission ? (
        <div className="scrollbar-sleek min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{view.title}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <MissionStateBadge view={view} />
              <VerdictChip view={view} />
            </div>
          </div>
          <MissionBannerBlock view={view} />
          <MissionProgressLine view={view} />
          <div className="space-y-2">
            <SendMessageBox view={view} />
            <MissionActionButtons view={view} client={client} />
          </div>
          {view.detailAvailable ? (
            <section className="space-y-1.5">
              <SectionLabel count={view.features.length || undefined}>Plan</SectionLabel>
              <MilestoneList view={view} />
            </section>
          ) : null}
          <section className="space-y-1.5">
            <SectionLabel count={view.workers.length || undefined}>Workers</SectionLabel>
            <WorkerList view={view} selectedId={selectedId} onSelect={setSelectedId} showModel={false} finishedLimit={3} />
            {selected && view.detailAvailable ? (
              <div className="rounded-md border border-border p-3">
                <WorkerDetail view={view} worker={selected} client={client} />
              </div>
            ) : null}
          </section>
          {view.detailAvailable ? (
            <section className="space-y-1.5">
              <SectionLabel>Progress</SectionLabel>
              <ProgressLog entries={view.progress} limit={4} />
            </section>
          ) : null}
          <div className="space-y-2 border-t border-border pt-3">
            <MissionFacts view={view} />
            <MissionModels view={view} />
          </div>
        </div>
      ) : (
        <MissionEmptyState client={client} />
      )}
    </>
  )
}

export function MissionControlVariantSidebar({ view, client }: { view: MissionView; client: ClientKind }): React.JSX.Element {
  return (
    <DesktopFrame view={view} rightPanel={<SidebarPanel key={view.scenario} view={view} client={client} />}>
      <TerminalMock view={view} />
    </DesktopFrame>
  )
}
