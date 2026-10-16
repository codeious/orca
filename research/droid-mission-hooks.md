# What hooks and session metadata does a Mission produce inside a Droid terminal session?

Observed on Droid 0.242.1 (macOS arm64) in Orca 1.4.224. One throwaway one-feature Mission ran in a scratch git repo under `/tmp`. It was started by hand with `/missions` in a Droid terminal session in an Orca pane, killed while its worker ran, resumed in a new terminal, and then continued to completion with scrutiny validation. Shapes only: no session or Mission ids, prompts, transcripts, or file contents.

## Question

From [What hooks and session metadata does a Mission produce inside a Droid terminal session?](https://github.com/codeious/orca/issues/24):

1. **Worker hooks.** Which hook events the in-process workers and validators fire, which session id each event carries, and which Orca status row each lands on today.
2. **Session metadata.** Whether the orchestrator session's metadata on disk names its Mission (`decompMissionId`, `decompSessionType`) when `/missions` starts inside an existing session, and at what point it is written.
3. **Death and resume.** Kill the terminal's `droid` while a worker is running, record what the Mission files say, then resume the orchestrator session in a new Droid terminal session and record what Droid does.

## Short answer

- **Every Mission session fires ordinary hooks from the TUI process, with its own session id, and lands on the terminal's one row.** That covers the implementation worker, the scrutiny validator (a second Mission worker), and the validator's reviewer (a `Task` subagent). All hook processes were children of the TUI `droid` and carried the pane's `ORCA_PANE_KEY`. Orca's Droid listener keys by pane and ignores `session_id`.
- **So Orca marks a Mission pane `done` while the Mission is still running.** Each worker's, validator's, and subagent's `Stop` set the row to `done`: three times in an 83-second run before the orchestrator's own `Stop`. Each worker's `SessionStart` and `UserPromptSubmit` also reset the row's prompt and tool.
- **`calling_session_id` names the parent session, not the Mission.** A worker's `SessionStart` carries the orchestrator's id; the reviewer subagent's carries the validator's id. The orchestrator's has no such key.
- **The Mission link on disk is a session tag, not `decomp*` fields.** No file held `decompMissionId` or `decompSessionType`. `/missions` writes `tags` into the session's `.settings.json`: `{name: "mission-session", metadata: {role, missionId}}`. Workers and validators get role `worker` plus `exec` and `mission-worker` tags. A subagent gets only `{name: "subagent"}`, with no Mission id.
- **The Mission id is the orchestrator's session id**, and the tag is written when `/missions` is typed, before the first prompt and before the Mission directory exists.
- **Killing the TUI leaves the Mission files saying `running`.** No pause, worker-end, or failure event is written, no hook fires, and Orca's row disappears about a second later without a `Stop`.
- **Resuming the orchestrator pauses the Mission and nothing else.** At session load Droid reconciles the stale `running` state to `paused`, appends `mission_paused`, and marks the interrupted `StartMissionRun` call cancelled. No worker runs until the user prompts.
- **Continuing resumes the same worker session.** On "Continue the mission." the orchestrator called `StartMissionRun`, Droid logged `Auto-resuming paused worker session`, wrote `mission_resumed` with `resumeWorkerSessionId`, and the original worker fired `SessionStart` with `source: "resume"`. No replacement worker was created. The Mission then validated and completed.

## Findings

### Timeline: start and kill (seconds after the launcher started `droid`)

| Time | Event |
| --- | --- |
| 1.4 | TUI `droid` running in the Orca pane |
| 27.8 | `[TuiDaemonAdapter] Opening in-process connection`; `[Daemon] Hosting Droid agent in process` |
| 28.0 | `SessionStart` (orchestrator session), `source: "startup"` |
| 29.5 | Session `.settings.json` written, `interactionMode: "auto"`, no `tags` |
| 33.3 | `/missions`: `updateSessionSettings`, `setTags` with `mission-session` / `orchestrator` / `missionId`, `Updated decomp session type from tags` (type `orchestrator`) |
| 33.5 | `.settings.json` now has `interactionMode: "mission"` and `tags` |
| 55.3 | `UserPromptSubmit` (the Mission request) |
| 55.9 | `[MissionWakeLock] Acquired mission wake lock`; `caffeinate` child of the TUI at 57.4 |
| 57.4 | Mission directory appears: `state.json` (`planning`), `working_directory.txt` |
| 71.5 | `PreToolUse` `AskUser`, then `Notification` `elicitation_dialog` |
| 91.5 | `PreToolUse` `ProposeMission`, then `Notification` `permission_prompt` |
| 98.0 | Mission accepted: `mission.md`, `model-settings.json`, `progress_log.jsonl` (`mission_accepted`) |
| 121–123 | Orchestrator `Create` calls write the planning files and `features.json` |
| 128.2 | `PreToolUse` `StartMissionRun` |
| 129.1 | Worker `SessionStart` with `calling_session_id`; `mission_run_started`, `worker_selected_feature`, `worker_started`; state `running`; worker `.settings.json` created |
| 129.2 | Worker `UserPromptSubmit` |
| 132.6 | Worker `PreToolUse` / `PostToolUse` (`Skill`, `Read`) |
| 133.4 | TUI killed with `SIGKILL` (4 s into the worker, after 10 worker hook events) |
| 134.5 | Orca's row for the pane is gone |
| 135.5 | TUI and `caffeinate` gone |

### Timeline: continue (seconds after "Continue the mission." was submitted in the resumed session)

| Time | Hooks | Mission files | Orca row |
| --- | --- | --- | --- |
| 0 | Orchestrator `UserPromptSubmit` | | `working`, prompt shown |
| 4 | Orchestrator `PreToolUse` `TodoWrite`, `StartMissionRun`; Droid logs `Auto-resuming paused worker session` | | `working`, tool `TodoWrite` |
| 5 | Worker `SessionStart` (`source: "resume"`), `UserPromptSubmit` (about 0.4 KB, against about 2 KB at first start) | `running`; `mission_resumed`, `mission_run_started` | prompt cleared |
| 9–31 | Worker `Execute` / `Create` pairs, then `EndFeatureRun` | | `working`, worker's tools |
| 31 | Validator `SessionStart` (`source: "startup"`), `UserPromptSubmit` (about 1.6 KB) | `worker_completed`, `milestone_validation_triggered`, `worker_selected_feature`, `worker_started`; handoff file; a second feature added | |
| 32 | Worker `Stop`, `SessionEnd` | | **`done`** |
| 34–40 | Validator `Read`, `Skill`, `Execute` | | `working` |
| 45 | Validator `PreToolUse` `Task` (`scrutiny-feature-reviewer`); reviewer `SessionStart` twice (`startup`, then `resume`), `UserPromptSubmit` | | `working`, prompt shows the reviewer's |
| 48–66 | Reviewer `Execute` × 3 | review file written | workspace missing from `worktree ps` (see below) |
| 67 | Reviewer `Stop` | | |
| 68 | Validator `SubagentStop`, `PostToolUse` `Task` | | **`done`**, then `working` at 70 |
| 73–82 | Validator `Execute`, `Create`, `EndFeatureRun` | synthesis file written | `working` |
| 83 | Orchestrator `PostToolUse` `StartMissionRun`; validator `Stop`, `SessionEnd` | `orchestrator_turn`; `worker_completed` | **`done`** |
| 89 | Orchestrator `DismissHandoffItems` | `handoff_items_dismissed` | `working` |
| 93 | Orchestrator `StartMissionRun` again (returns at once) | `completed`; `mission_run_started` | |
| 97–107 | Orchestrator `Read`, `Execute`, `TodoWrite` | | |
| 110 | Orchestrator `Stop` | | `done` |

No `Notification` fired during the continue phase, and no approval was asked. Both `Notification` events of the run were the orchestrator's `AskUser` and `ProposeMission` before the kill.

### 1. Worker hooks

- **Events per session** (continue phase):

  | Session | `SessionStart` | `UserPromptSubmit` | `PreToolUse` / `PostToolUse` | `Stop` | `SubagentStop` | `SessionEnd` |
  | --- | --- | --- | --- | --- | --- | --- |
  | Orchestrator | 0 (1 at resume) | 1 | 7 / 7 | 1 | 0 | 0 |
  | Implementation worker (resumed) | 1, `resume` | 1 | 7 / 7 | 1 | 0 | 1 |
  | Scrutiny validator | 1, `startup` | 1 | 10 / 9 | 1 | 1 | 1 |
  | Reviewer subagent | 2, `startup` then `resume` | 1 | 3 / 3 | 1 | 0 | 0 |

  Before the kill, the implementation worker had fired `SessionStart` 1, `UserPromptSubmit` 1, `PreToolUse` 4, `PostToolUse` 4. The validator's one unmatched `PreToolUse` is an `Execute` at 36 s that never got a `PostToolUse`; the cause was not checked. Its `Task` call was matched: `PostToolUse` fired after the reviewer finished.
- **Session ids.** Every event carried its own session's `session_id`. `SubagentStop` is the exception that proves the pattern: it carries the parent's (the validator's) `session_id`, plus `task_name` and `task_result`, and no subagent id.
- **`calling_session_id`** appears only on `SessionStart`. Implementation worker and validator: the orchestrator's id. Reviewer subagent: the validator's id. Orchestrator: absent. A resumed `SessionStart` also carries `message_id`, which a startup `SessionStart` lacks.
- **Payload keys of the end events.** `Stop`: `elapsed_time`, `message_id`, `stop_hook_active`, `tool_execution_count`, plus the common `cwd`, `hook_event_name`, `permission_mode`, `session_id`, `transcript_path`. `SessionEnd`: `message_count`, `message_id`, `reason` (`"other"` for both workers), `session_duration_ms`. Orca does not install `SessionEnd`.
- **`SessionEnd`** fired for the implementation worker and the validator when their feature run ended, not for the subagent, and not for the orchestrator while its TUI stayed open.
- **`permission_mode`.** Orchestrator `auto-medium` (the profile default); implementation worker, validator, and reviewer `auto-high`.
- **`StartMissionRun` brackets the run.** Its `PreToolUse` came at 4 s and its `PostToolUse` at 83 s, after the validator ended. A second `StartMissionRun` at 93 s returned at once and marked the Mission `completed`.
- **Process and environment.** Every hook process had the TUI `droid` as its parent and saw the pane's `ORCA_PANE_KEY`, `ORCA_TAB_ID`, and `ORCA_WORKTREE_ID`. No worker process appeared.
- **Orca's row today** (read from `orca worktree ps --json` every second, the real status store):
  - One row for the pane, `agentType: "droid"`, `parentPaneKey: null`, for the whole run. No child row appeared for any worker or subagent.
  - `Stop` from any session sets `done` (`normalizeDroidEvent` maps `Stop` to `done` with no session check; `SubagentStop` is ignored). The worker's, reviewer's, and validator's `Stop` each set the row `done` mid-Mission, and the next worker event set it back to `working`.
  - `SessionStart` from any session clears the pane's turn cache, and `UserPromptSubmit` replaces the row's prompt. The implementation worker's prompt showed as empty on the row; the reviewer's showed its first line.
  - From the code, not observed: a worker's `PreToolUse` with `riskLevel: "high"` would set the row `waiting`, though a worker at `auto-high` runs it without asking. This run's worker commands were `low` or `medium`.
  - Between 49 and 65 s the scratch workspace was missing from `worktree ps` output, then came back with no agent rows until the reviewer's `Stop` set `done` at 68 s. No hook in that window should remove a row; the cause was not found.
  - After the kill, the row was removed within about a second, with no `done` state and `interrupted: false`. The workspace stayed `live` (the pane's shell was alive).

### 2. Session metadata

- **No `decomp*` fields on disk.** The watcher searched every file under the profile (except Droid's own log) for `decomp` on every change. The only hit was the word "decomposition" inside a tool result. No `.settings.json` or transcript `session_start` record has `decompMissionId` or `decompSessionType` in 0.242.1. The binary still has those names and logs `Updated decomp session type from tags`, so they are in-memory values derived from tags.
- **Where the link is.** `.settings.json` `tags`, an array of `{name, metadata?}`:
  - Orchestrator: `[{name: "mission-session", metadata: {role: "orchestrator", missionId}}]`.
  - Implementation worker and validator: `[{name: "exec"}, {name: "mission-worker"}, {name: "mission-session", metadata: {role: "worker", missionId}}]`. The tags do not tell a validator from an implementation worker; the feature id in the Mission files does (`scrutiny-validator-<milestone>`).
  - Reviewer subagent: `[{name: "subagent"}]`. No Mission id; its link to the Mission is two hops, through `callingSessionId` to the validator, then the validator's tag.
- **When it is written.** At `/missions`, 33.3 s, through `updateSessionSettings` and `setTags`, together with `interactionMode: "mission"`. That is before the first prompt (55.3 s), the Mission directory (57.4 s), and acceptance (98.0 s). The `missionId` in the tag already equals the session id, and no later `setTags` changed it.
- **Mission id equals the orchestrator session id.** So the orchestrator's hook `session_id` is the Mission directory name, and a worker's `calling_session_id` names the Mission too. A subagent's does not.
- **Transcripts.** A worker's or subagent's `session_start` record has `callingSessionId`, matching its hook's `calling_session_id`. The orchestrator's has none. None carries a Mission field.
- **Deviation.** The ticket asked for `/missions` inside an existing session. The run sent no prompt before `/missions`, so the session existed (`SessionStart` had fired and `.settings.json` was written) but had no turns. Whether `/missions` after earlier turns writes the same tag at the same point was not observed.

### 3. Death

- `SIGKILL` on the TUI at 133.4 s, 4 s after the worker started.
- **Mission files afterwards:** `state.json` `state: "running"`; the feature `in_progress` with `currentWorkerSessionId` set and no `completedWorkerSessionId`; `progress_log.jsonl` ending at `worker_started`. No `mission_paused`, worker-end, or failure event. No handoff, `worker-transcripts.jsonl`, or `validation/` yet.
- Both sessions' `.settings.json` remained, each with a `.settings.json.bak` sibling.
- `caffeinate` exited with the TUI. No `droid` process survived. No hook fired on the kill.
- The worker had made no commit and left no file changes. No worktree, branch, or `~/.factory/worktrees` entry appeared.
- Droid's own log stops at 115.6 s, 18 s before the kill: the `SIGKILL` lost its unflushed buffer.

### Resume

- The user opened a new terminal tab in the same workspace and resumed the orchestrator session through the launcher (`droid --resume <session id>`), with no prompt.
- **Hooks.** One `SessionStart` for the orchestrator session, `source: "resume"`. Nothing else fired until the user prompted. Orca created no row (its Droid listener ignores `SessionStart`).
- **What Droid did, within 1.1 s of loading the session:**
  - `[reconcileMissionStateAfterSessionLoad] Reconciled stale mission state on session load`, with context `baseSessionId`, the stale `state: "running"`, `workerSessionId`, and `featureId`.
  - `state.json` went from `running` to `paused`, and `progress_log.jsonl` gained `mission_paused` (no fields beyond `timestamp` and `type`).
  - `[uiProjection] Healed stale transcript liveness claim` twice, for the pending `TodoWrite` and `StartMissionRun` calls. The TUI then shows `StartMissionRun` as "Tool cancelled: no result was received for this tool call", with the orchestrator's plan item for the run still in progress.
  - The feature stayed `in_progress` with the killed worker as `currentWorkerSessionId`.
  - Droid logged `Current session has no live conversation history; loading from disk` and hosted the session in process again.
- **Continue.** After the prompt, `StartMissionRun` resumed that same worker session (`Auto-resuming paused worker session`; `mission_resumed` with `resumeWorkerSessionId`; worker `SessionStart` `source: "resume"`). The feature's worker list stayed at one session.
- So the answer to "orphan cleanup, pause, or requeue" is **pause, then resume the same worker on the next run.** Reconciliation runs at session load; nothing runs until the orchestrator starts a run.

### Validation and completion

- After the implementation worker's `EndFeatureRun`, Droid wrote `worker_completed` (`successState: "success"`, `validatorsPassed: true`, `returnToOrchestrator: false`, a commit id), then `milestone_validation_triggered` with the milestone and feature.
- Validation ran as a second feature, `scrutiny-validator-<milestone>`, added to `features.json` and run by a new worker session. That worker ran the `scrutiny-feature-reviewer` subagent through `Task`, then wrote its own handoff and `worker_completed` with `returnToOrchestrator: true`.
- The orchestrator dismissed handoff items (`handoff_items_dismissed`), started a run that found nothing left, and the Mission became `completed`. `MissionRunner` logged `Loop ended` for each run.
- **Mission files at the end:** `AGENTS.md`, `architecture.md`, `features.json`, `handoffs/` (one per worker session, named `<timestamp>__<featureId>__<workerSessionId>.json`), `init.sh`, `library/environment.md`, `library/user-testing.md`, `mission.md`, `model-settings.json`, `progress_log.jsonl`, `runtime-custom-models.json`, `services.yaml`, `skills/<worker skill>/SKILL.md`, `state.json` (adds `lastReviewedHandoffCount`), `validation-contract.md`, `validation-state.json` (`assertions`), `validation/<milestone>/scrutiny/reviews/<featureId>.json`, `validation/<milestone>/scrutiny/synthesis.json`, `worker-transcripts.jsonl`, `working_directory.txt`.
- **Git.** The implementation worker made one commit on the checked-out branch of the scratch repo. The validator made none. Both `worker_completed` records name that commit, the worker's as a 7-character hash and the validator's as a full hash. No worktree or branch was created.
- **Progress event types in order:** `mission_accepted`, `mission_run_started`, `worker_selected_feature`, `worker_started`, `mission_paused`, `mission_resumed`, `mission_run_started`, `worker_completed`, `milestone_validation_triggered`, `worker_selected_feature`, `worker_started`, `worker_completed`, `handoff_items_dismissed`, `mission_run_started`. There is no `mission_completed` event; `completed` appears only in `state.json`.

## Credits

22,063 units in total, against an agreed cap of 300,000 (the watcher would have killed the TUI at 285,000).

| Session | Units |
| --- | --- |
| Orchestrator | 12,866 |
| Implementation worker | 4,344 (1,149 before the kill) |
| Scrutiny validator | 2,535 |
| Reviewer subagent | 2,318 |

The kill phase used 7,465 units; the resume and continue used 14,598. Every role used one custom model, Claude Haiku 5.5, at effort `low`; scrutiny on, user testing off.

## What this changes for the spec

- **Linking from hooks works without reading Mission files.** The orchestrator's `session_id` is the Mission id. A worker's or validator's `SessionStart` names the orchestrator in `calling_session_id`. A subagent names its parent session instead, so following `calling_session_id` up to a session without one finds the lead.
- **ADR 0005's linking clause names the wrong fields for 0.242.1.** The on-disk link is the `mission-session` tag in `.settings.json`, not `decompMissionId` or `decompSessionType`.
- **ADR 0005's rule that worker events never move the terminal's row does not hold today.** Orca's Droid listener routes by pane only. Worker, validator, and subagent `Stop` events mark a running Mission `done`, and their `SessionStart` and `UserPromptSubmit` reset the row's prompt and tool. The listener needs a per-pane lead session: the first session seen on the pane, or one whose `SessionStart` has no `calling_session_id`. Events from other sessions must not change the row's state. This applies to any Droid `Task` subagent in a terminal, not only Missions; this run observed it only inside a Mission.
- **A Mission run looks like one long tool call on the lead session.** `StartMissionRun` stays open from the start of a run until its workers finish, so a row driven only by the orchestrator would show `working` on `StartMissionRun` for the whole run.
- **Mission files cannot tell a killed Mission from a running one**: after a kill they still say `running` until the orchestrator session is loaded again. This confirms ADR 0005's rule that only the terminal's verdict decides. Once resumed, `paused` is truthful, and continuing reuses the same worker session ids, so a Mission's session list does not grow after an interruption.

## Method

- **Profile.** A throwaway `HOME` under `/tmp` with a `settings.json` built from the real one: one custom model at effort `low` for every role, Mission settings with scrutiny on and user testing off, and hooks. `FACTORY_API_KEY` came from a key file outside the repo, `FACTORY_DISABLE_KEYRING=1`, `FACTORY_DROID_AUTO_UPDATE_ENABLED=false`. The real `~/.factory` was only read.
- **Hooks.** Each of Orca's eight Droid events ran Orca's real managed hook command and then a logger. `SessionEnd` and `PreCompact` ran the logger alone. Droid 0.242.1 logs `Ignoring unknown hook event keys` for `PermissionRequest`. The logger recorded key names, event, session id, tool name, notification type, hook parent pid, and the Orca pane variables. Raw payloads stayed under `/tmp`.
- **Launcher.** The user ran a launcher script in an Orca terminal in the scratch workspace, for both the start and the resume. It kept the pane's `ORCA_*` variables so Orca's real hook reported to that pane. The continue prompt was typed into the resumed pane through `orca terminal send`.
- **Watchers.** A disk and process watcher polled every 2 s: TUI descendants, the Mission directory (files, `state.json`, `progress_log.jsonl` types, `features.json` shape), every session `.settings.json` (keys, `interactionMode`, credits), any `decomp` text in the profile, and git state. A second poller read `orca worktree ps --json` every second and logged each change to the scratch workspace's agent rows.
- **Kill.** A script waited for `worker_started`, then for three hook events carrying the worker's session id (or 45 s), then sent `SIGKILL` to the TUI.

## State left behind

- Everything is under `/tmp/droid-mission-hooks`: the scratch repo (two commits), the throwaway profile (four sessions, one completed Mission), probe scripts, and logs with raw hook payloads. The probes are stopped.
- The resumed Droid terminal session is still open in an Orca tab in the scratch workspace, and the killed session's tab is back at a shell. The scratch repo is still an Orca workspace.
- The real `~/.factory` was not changed. The key file stays outside the repo, where the user put it.
