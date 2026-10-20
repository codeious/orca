// PROTOTYPE (throwaway, prototype/droid-mission-control branch only): mock Mission data for the
// Mission Control layout prototype. Scenarios follow the failure-case table in codeious/orca#11.
import type { AgentDotState } from '@/components/AgentStateDot'

export type PrototypeVariantKey = 'A' | 'B' | 'C' | 'D' | 'E'

export const PROTOTYPE_VARIANTS: { key: PrototypeVariantKey; name: string }[] = [
  { key: 'A', name: 'Right sidebar panel' },
  { key: 'B', name: 'Workspace tab' },
  { key: 'C', name: 'Strip on the terminal pane' },
  { key: 'D', name: 'Mobile: card on the session screen' },
  { key: 'E', name: 'Mobile: own Mission screen' }
]

export type ScenarioId =
  | 'none'
  | 'planning'
  | 'approval'
  | 'running'
  | 'paused'
  | 'interrupted'
  | 'unverifiable'
  | 'unavailable'
  | 'observed'
  | 'completed'

export const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: 'none', label: 'No Mission yet' },
  { id: 'planning', label: 'Planning: Droid asks (AskUser)' },
  { id: 'approval', label: 'Plan waiting (ProposeMission)' },
  { id: 'running', label: 'Running' },
  { id: 'paused', label: 'Paused at retry limit' },
  { id: 'interrupted', label: 'Interrupted (terminal exited)' },
  { id: 'unverifiable', label: 'Unverifiable (SSH dropped)' },
  { id: 'unavailable', label: 'Detail unavailable (below floor)' },
  { id: 'observed', label: 'Observed (Factory App)' },
  { id: 'completed', label: 'Completed' }
]

export type ClientKind = 'desktop' | 'web'
export type Verdict = 'live' | 'unverifiable' | 'exited'
export type FeatureStatus = 'pending' | 'in_progress' | 'completed' | 'partial' | 'failed'

export type MissionMilestone = { id: string; title: string; validated: boolean }

export type MissionFeature = {
  id: string
  title: string
  milestoneId: string
  status: FeatureStatus
  attempts: number
  workerId?: string
}

export type MissionWorker = {
  id: string
  kind: 'worker' | 'validator' | 'subagent'
  /** What the row says. Hooks carry no worker name, so without Mission files this is a session id. */
  label: string
  featureId?: string
  parentId?: string
  sessionId: string
  dotState: AgentDotState
  model: string
  started: string
  ended?: string
  successState?: 'success' | 'partial' | 'failure'
  handoff?: { summary: string; discoveredIssues: string[] }
}

export type ProgressEntry = { ago: string; kind: string; text: string }

export type MissionBanner = {
  tone: 'attention' | 'warning' | 'muted'
  title: string
  body?: string
}

export type MissionActionId = 'start' | 'openTerminal' | 'send' | 'resume' | 'resumeConfirm'

export type MissionAction = { id: MissionActionId; label: string; primary?: boolean; hint?: string }

export type MissionView = {
  scenario: ScenarioId
  hasMission: boolean
  title: string
  missionId: string
  stateLabel: string
  stateDot: AgentDotState
  verdict: Verdict
  hostLabel: string
  banner: MissionBanner | null
  /** Phase read from the lead row's open tool (hooks). */
  phase: string
  detailAvailable: boolean
  readOnly: boolean
  milestones: MissionMilestone[]
  features: MissionFeature[]
  workers: MissionWorker[]
  progress: ProgressEntry[]
  models: { orchestrator: string; worker: string; validator: string }
  elapsed: string
  credits: string
  lastProgressAgo: string
  lastHookAgo: string
  actions: MissionAction[]
  lead: { dotState: AgentDotState; prompt: string; tool: string }
}

const MILESTONES: MissionMilestone[] = [
  { id: 'm1', title: 'Limiter core', validated: true },
  { id: 'm2', title: 'Middleware and config', validated: false },
  { id: 'm3', title: 'Docs and rollout', validated: false }
]

const FEATURES: MissionFeature[] = [
  { id: 'f1', milestoneId: 'm1', title: 'Token bucket store on Redis', status: 'completed', attempts: 1, workerId: 'w1' },
  { id: 'f2', milestoneId: 'm1', title: 'In-memory fallback store', status: 'completed', attempts: 1, workerId: 'w2' },
  { id: 'f3', milestoneId: 'm1', title: 'Limit key from API token', status: 'completed', attempts: 1, workerId: 'w3' },
  { id: 'f4', milestoneId: 'm2', title: 'Per-route limits in config', status: 'completed', attempts: 2, workerId: 'w5' },
  { id: 'f5', milestoneId: 'm2', title: 'Express middleware', status: 'in_progress', attempts: 1, workerId: 'w6' },
  { id: 'f6', milestoneId: 'm2', title: '429 response with Retry-After', status: 'pending', attempts: 0 },
  { id: 'f7', milestoneId: 'm2', title: 'Metrics for rejected requests', status: 'pending', attempts: 0 },
  { id: 'f8', milestoneId: 'm3', title: 'Operator docs', status: 'pending', attempts: 0 },
  { id: 'f9', milestoneId: 'm3', title: 'Staged rollout flag', status: 'pending', attempts: 0 }
]

const WORKERS: MissionWorker[] = [
  { id: 'w6', kind: 'worker', label: 'Express middleware', featureId: 'f5', sessionId: '7a1e…c2', dotState: 'working', model: 'Sonnet 4.5', started: '6m ago' },
  { id: 's1', kind: 'subagent', label: 'Explore middleware stack', parentId: 'w6', sessionId: '0b9d…41', dotState: 'working', model: 'Sonnet 4.5', started: '1m ago' },
  {
    id: 'w5', kind: 'worker', label: 'Per-route limits in config', featureId: 'f4', sessionId: '55c0…9e', dotState: 'done', model: 'Sonnet 4.5', started: '9m ago', ended: '3m ago', successState: 'success',
    handoff: { summary: 'Reads limits from config/rate-limits.yaml with a per-route override.', discoveredIssues: [] }
  },
  {
    id: 'w4', kind: 'worker', label: 'Per-route limits in config', featureId: 'f4', sessionId: 'd310…07', dotState: 'unconfirmed', model: 'Sonnet 4.5', started: '15m ago', ended: '9m ago', successState: 'partial',
    handoff: { summary: 'Config schema added; route matcher left unfinished.', discoveredIssues: ['Route patterns with params never match the override table.'] }
  },
  {
    id: 'v1', kind: 'validator', label: 'Scrutiny: Limiter core', sessionId: '9f2a…13', dotState: 'done', model: 'Haiku 4.5', started: '18m ago', ended: '15m ago', successState: 'success',
    handoff: { summary: 'All three features pass review and tests.', discoveredIssues: [] }
  },
  {
    id: 'w3', kind: 'worker', label: 'Limit key from API token', featureId: 'f3', sessionId: '3c47…a8', dotState: 'done', model: 'Sonnet 4.5', started: '24m ago', ended: '18m ago', successState: 'success',
    handoff: { summary: 'Hashes the token; anonymous calls fall back to client IP.', discoveredIssues: [] }
  },
  {
    id: 'w2', kind: 'worker', label: 'In-memory fallback store', featureId: 'f2', sessionId: 'e8b1…5d', dotState: 'done', model: 'Sonnet 4.5', started: '31m ago', ended: '24m ago', successState: 'success',
    handoff: { summary: 'LRU store used when Redis is down.', discoveredIssues: [] }
  },
  {
    id: 'w1', kind: 'worker', label: 'Token bucket store on Redis', featureId: 'f1', sessionId: '12fa…6b', dotState: 'done', model: 'Sonnet 4.5', started: '40m ago', ended: '31m ago', successState: 'success',
    handoff: { summary: 'Lua script keeps refill and take atomic.', discoveredIssues: [] }
  }
]

const PROGRESS: ProgressEntry[] = [
  { ago: '6m', kind: 'worker_started', text: 'Worker started: Express middleware' },
  { ago: '3m', kind: 'worker_completed', text: 'Worker finished: Per-route limits in config (success)' },
  { ago: '9m', kind: 'worker_completed', text: 'Worker finished: Per-route limits in config (partial)' },
  { ago: '15m', kind: 'milestone_validated', text: 'Milestone validated: Limiter core' },
  { ago: '18m', kind: 'worker_completed', text: 'Worker finished: Limit key from API token' },
  { ago: '41m', kind: 'mission_started', text: 'Mission started' }
].sort((a, b) => Number.parseInt(a.ago, 10) - Number.parseInt(b.ago, 10))

const BASE: MissionView = {
  scenario: 'running',
  hasMission: true,
  title: 'Rate-limit the public API',
  missionId: '3f9c2d1e',
  stateLabel: 'Running',
  stateDot: 'working',
  verdict: 'live',
  hostLabel: 'Local',
  banner: null,
  phase: 'Running workers',
  detailAvailable: true,
  readOnly: false,
  milestones: MILESTONES,
  features: FEATURES,
  workers: WORKERS,
  progress: PROGRESS,
  models: { orchestrator: 'Opus 4.6', worker: 'Sonnet 4.5', validator: 'Haiku 4.5' },
  elapsed: '41m',
  credits: '18,420',
  lastProgressAgo: '3m ago',
  lastHookAgo: '8s ago',
  actions: [
    { id: 'send', label: 'Send' },
    { id: 'openTerminal', label: 'Open terminal', hint: 'Pause is in the terminal until the interrupt check lands' }
  ],
  lead: { dotState: 'working', prompt: 'Rate-limit the public API', tool: 'StartMissionRun' }
}

const withWorkers = (patch: Partial<Record<string, Partial<MissionWorker>>>): MissionWorker[] =>
  WORKERS.map((w) => ({ ...w, ...patch[w.id] }))

export function buildMissionView(scenario: ScenarioId): MissionView {
  switch (scenario) {
    case 'none':
      return { ...BASE, scenario, hasMission: false, actions: [{ id: 'start', label: 'Start Mission', primary: true }] }
    case 'planning':
      return {
        ...BASE, scenario, stateLabel: 'Planning', stateDot: 'waiting', phase: 'Droid is asking you',
        banner: { tone: 'attention', title: 'Droid is asking you', body: 'Answer in the terminal to keep planning.' },
        milestones: [], features: [], workers: [], progress: [], elapsed: '4m', credits: '310', lastProgressAgo: '—',
        actions: [{ id: 'openTerminal', label: 'Answer in terminal', primary: true }],
        lead: { dotState: 'waiting', prompt: 'Rate-limit the public API', tool: 'AskUser' }
      }
    case 'approval':
      return {
        ...BASE, scenario, stateLabel: 'Plan ready', stateDot: 'waiting', phase: 'Plan waiting for your approval',
        banner: { tone: 'attention', title: 'Plan waiting for your approval', body: 'Review, change, or approve the plan in the terminal.' },
        milestones: [], features: [], workers: [], progress: [], elapsed: '9m', credits: '1,240', lastProgressAgo: '—',
        actions: [{ id: 'openTerminal', label: 'Review plan in terminal', primary: true }],
        lead: { dotState: 'waiting', prompt: 'Rate-limit the public API', tool: 'ProposeMission' }
      }
    case 'running':
      return BASE
    case 'paused':
      return {
        ...BASE, scenario, stateLabel: 'Paused', stateDot: 'interrupted', phase: 'Paused by Droid',
        banner: { tone: 'warning', title: 'Paused: feature retry limit reached', body: '“Express middleware” failed 3 times. Tell Droid how to continue.' },
        features: FEATURES.map((f) => (f.id === 'f5' ? { ...f, status: 'failed', attempts: 3 } : f)),
        workers: withWorkers({ w6: { dotState: 'failed', ended: '1m ago', successState: 'failure', handoff: { summary: 'Middleware order conflicts with the auth guard.', discoveredIssues: ['Auth guard runs after the limiter, so the token key is empty.'] } }, s1: { dotState: 'done', ended: '2m ago' } }),
        progress: [{ ago: '1m', kind: 'mission_paused', text: 'Mission paused: feature retry limit (Express middleware)' }, ...PROGRESS],
        lastProgressAgo: '1m ago', lastHookAgo: '1m ago',
        lead: { dotState: 'done', prompt: 'Rate-limit the public API', tool: '' }
      }
    case 'interrupted':
      return {
        ...BASE, scenario, stateLabel: 'Interrupted', stateDot: 'interrupted', verdict: 'exited', phase: 'Terminal exited',
        banner: { tone: 'warning', title: 'Interrupted', body: 'The terminal running this Mission exited while a worker ran. Resume opens it in a new terminal.' },
        workers: withWorkers({ w6: { dotState: 'interrupted' }, s1: { dotState: 'interrupted' } }),
        lastProgressAgo: '2h ago', lastHookAgo: '2h ago',
        actions: [{ id: 'resume', label: 'Resume', primary: true, hint: 'Opens droid --resume 3f9c2d1e with “Continue the mission.” typed, not sent' }],
        lead: { dotState: 'interrupted', prompt: 'Rate-limit the public API', tool: '' }
      }
    case 'unverifiable':
      return {
        ...BASE, scenario, stateLabel: 'Last known: running', stateDot: 'unverifiable', verdict: 'unverifiable', hostLabel: 'SSH · build-box',
        banner: { tone: 'warning', title: 'Can’t confirm it is still running', body: 'No update from build-box for 4 min. Showing the last known state.' },
        workers: withWorkers({ w6: { dotState: 'unverifiable' }, s1: { dotState: 'unverifiable' } }),
        lastProgressAgo: '7m ago', lastHookAgo: '4m ago',
        actions: [
          { id: 'resumeConfirm', label: 'Resume…', hint: 'Asks first: it may still be running on build-box' },
          { id: 'openTerminal', label: 'Open terminal' }
        ],
        lead: { dotState: 'unverifiable', prompt: 'Rate-limit the public API', tool: 'StartMissionRun' }
      }
    case 'unavailable':
      return {
        ...BASE, scenario, detailAvailable: false, title: 'Mission', stateLabel: 'Running', phase: 'Running workers',
        banner: { tone: 'muted', title: 'Mission detail unavailable on Droid 0.237.0', body: 'Showing the terminal and worker rows only. Droid 0.238.0 or later shows features and milestones.' },
        milestones: [], features: [], progress: [], credits: '—',
        workers: WORKERS.filter((w) => w.id === 'w6' || w.id === 's1').map((w) => ({ ...w, label: `${w.kind === 'subagent' ? 'Subagent' : 'Mission worker'} · ${w.sessionId}`, model: '—' }))
      }
    case 'observed':
      return {
        ...BASE, scenario, readOnly: true, stateLabel: 'Running elsewhere', stateDot: 'unverifiable', verdict: 'unverifiable', phase: 'Observed',
        banner: { tone: 'muted', title: 'Started in the Factory App', body: 'Orca only reads this Mission. Resume here moves it into an Orca terminal.' },
        workers: withWorkers({ w6: { dotState: 'unverifiable' }, s1: { dotState: 'unverifiable' } }),
        actions: [{ id: 'resumeConfirm', label: 'Resume here…', hint: 'Asks first: it may still be running in the Factory App' }],
        lead: { dotState: 'idle', prompt: '', tool: '' }
      }
    case 'completed':
      return {
        ...BASE, scenario, stateLabel: 'Completed', stateDot: 'done', phase: 'Completed',
        milestones: MILESTONES.map((m) => ({ ...m, validated: true })),
        features: FEATURES.map((f) => ({ ...f, status: 'completed', attempts: Math.max(f.attempts, 1) })),
        workers: withWorkers({ w6: { dotState: 'done', ended: '1h ago', successState: 'success' }, s1: { dotState: 'done', ended: '1h ago' } }),
        progress: [{ ago: '58m', kind: 'mission_completed', text: 'Mission completed' }, ...PROGRESS],
        elapsed: '1h 52m', credits: '46,905', lastProgressAgo: '58m ago', lastHookAgo: '58m ago',
        actions: [{ id: 'openTerminal', label: 'Open terminal' }],
        lead: { dotState: 'done', prompt: 'Rate-limit the public API', tool: '' }
      }
  }
}

export function featureDot(status: FeatureStatus): AgentDotState {
  switch (status) {
    case 'completed':
      return 'done'
    case 'in_progress':
      return 'working'
    case 'partial':
      return 'unconfirmed'
    case 'failed':
      return 'failed'
    case 'pending':
      return 'idle'
  }
}

export const FEATURE_STATUS_LABEL: Record<FeatureStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Done',
  partial: 'Partial',
  failed: 'Failed'
}

export function featureCounts(view: MissionView): { done: number; total: number } {
  return {
    done: view.features.filter((f) => f.status === 'completed').length,
    total: view.features.length
  }
}

export function currentMilestone(view: MissionView): { index: number; milestone: MissionMilestone | null } {
  const index = view.milestones.findIndex((m) => !m.validated)
  if (index === -1) {
    return { index: view.milestones.length - 1, milestone: view.milestones.at(-1) ?? null }
  }
  return { index, milestone: view.milestones[index] }
}

/** Desktop-only pieces per codeious/orca#11: Start Mission and the worker transcript tail. */
export function visibleActions(view: MissionView, client: ClientKind | 'mobile'): MissionAction[] {
  return view.actions.filter((a) => client === 'desktop' || a.id !== 'start')
}
