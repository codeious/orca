# Where do Mission workers and validators run?

Inspected Droid 0.238.0 (`~/.local/bin/droid`, Mach-O arm64) and the local `~/.factory` tree. No Mission was started. Shapes only: no session ids, paths, prompts, or project names.

## Question

Does a Mission's work run inside one Droid process, in child `droid` processes, in git worktrees, or through the daemon? Which processes, directories, worktrees, and branches does it create, who cleans them up, and what happens on pause, crash, and app quit? Can each worker be tied to a process so a host can state `live`, `unverifiable`, or `exited`? How do `-w` / `--worktree` and `~/.factory/worktrees` relate to a repo's own worktrees?

## Short answer

A Mission has one orchestrator Droid session and many worker sessions. Each worker is a delegated Droid process with its own session id, not an in-process function call and not a Task-tool subagent. The Factory daemon is the process supervisor: it spawns sessions, broadcasts `session_process_exited`, and MissionRunner turns an unexpected exit into `Worker process exited unexpectedly`. Workers run in the Mission's recorded working directory, which on this machine was never `~/.factory/worktrees`. `-w` is a separate git-worktree feature; its default directory was empty here. Mission directories and worker session transcripts are kept after completion. Pause interrupts the worker session and writes `mission_paused`. A dead orchestrator is reconciled on the next start by treating a leftover worker as an orphan and pausing. The durable worker id is `workerSessionId`. Mission state has no pid, and live `droid` argv, environ, and open files did not contain that id, so a missing process is not proof the worker exited.

## Findings

### Processes

The orchestrator is one Droid session.

- Interactive: `/missions` inside `droid`. Mission Control is an overlay (`Ctrl+T`). The process is an ordinary `droid`; `--mission` is not on its argv. Sources: [Missions overview](https://docs.factory.com/missions/overview), [CLI reference](https://docs.factory.com/docs/droid-cli/cli-reference) (slash command `/missions`, shortcut `Ctrl+T`).
- Headless: `droid exec --mission`, which needs `--auto high` or `--skip-permissions-unsafe`. `--worker-model` and `--validator-model` apply to agents the orchestrator spawns; `-m` stays the orchestrator. Sources: [Missions reference](https://docs.factory.com/docs/missions/reference), [Droid Exec](https://docs.factory.com/docs/droid-exec/overview), `droid exec --help` (0.238.0).

Workers are child sessions and delegated Droid processes.

- Settings call them "mission worker subagents" and say they do not use `subagentAutonomyLevel`, which is only for Task-tool subagents. Source: [settings](https://docs.factory.com/docs/droid-cli/settings) (`missionModelSettings`, Subagent autonomy level).
- `--disable-builtin-skills` is inherited by "child sessions, including subagents and mission workers." Source: [Droid Exec](https://docs.factory.com/docs/droid-exec/overview).
- The 0.238.0 binary names `MissionRunner.spawnWorker`, `spawnWorkerSession`, `resumeWorker`, `waitForWorkerCompletion`, `killWorkerSession`, and the JSON-RPC method `kill_worker_session`. A delegated session exits after its turn (`finishDelegatedTurn`). Log strings include `Delegated Droid process exited after completing its turn`, `Droid process exited unexpectedly (exit code`, and `Worker process exited unexpectedly`. Strings were read from the installed binary; they are log and schema fragments, not prompts.
- `spawnWorkerSession` carries `missionRole`, `missionFeatureId`, `missionSkillName`, `missionMilestone`, and `missionWorkerSessionId`. If the worker finishes without calling `end_feature_run`, the runner records `worker_failed` / `worker_exited_without_handoff`.

The daemon supervises those processes. It does not replace the orchestrator.

- `droid daemon --help`: `--droid-path` is "Path to droid executable for spawning sessions"; `--liveness-fd` and `--parent-pid` watch the parent; `--listen` is `websocket` or `ipc`.
- Binary notification names include `daemon.session_notification` and `session_process_exited`. On an unexpected exit the runner uses a spawn id prefixed `daemon_process_exit_`.
- At inspection, one `droid daemon --droid-path --listen` was a child of the Factory app and had no children. Interactive `droid` processes (parent shell) and `droid exec --output-format` processes were also running. None had `--mission`. Those exec processes are not evidence of a live Mission worker.

Task-tool subagents are a different registry.

- `~/.factory/task-invocations.json` records `parentSessionId`, `childSessionId`, `subagentType`, `runInBackground`, `cwd`, `processObservedAt`, and `completionReason` (`completed`, `error`, `cancelled`, `process_exit`, and provider failures).
- Zero of the Mission worker session ids appear as `childSessionId` there.
- Docs for background Task subagents: `TaskStop` sends `SIGTERM`, then `SIGKILL`. Source: [Custom droids](https://docs.factory.com/docs/harness/subagents). That lifecycle is not the Mission worker lifecycle.

Validators are not the same object as workers.

- Docs: validation workers run at the end of each milestone (scrutiny and user-testing). Both can be skipped. Sources: [Planning](https://docs.factory.com/docs/missions/planning), [settings](https://docs.factory.com/docs/droid-cli/settings).
- The same subagent doc says `scrutiny-feature-reviewer` and `user-testing-flow-validator` are written under `~/.factory/droids/` for Missions. Both files were present. `worker.md` and `explorer.md` were not.
- Local worker settings that list child sessions overlap Task invocations of type `user-testing-flow-validator` (106), `explorer` (6), and `worker` (6). `scrutiny-feature-reviewer` was not a `subagentType` in the invocation file. Progress logs have `milestone_validation_triggered` (126) and no separate validator-process event.
- So a user-testing validator is a Task subagent of a worker session. Whether scrutiny is its own process was not visible.

Local session graph (read-only):

- 59 Mission directories, each named with a UUID, under `~/.factory/missions/`.
- 46 of those have `features.json`. Unique `workerSessionId` values: 842. Every one has `~/.factory/sessions/<cwd-slug>/<id>.jsonl` and a sibling `.settings.json`.
- Every worker `session_start` has a `callingSessionId`. All 842 point at a session that is not itself a worker. Those parents are root sessions (no `callingSessionId` of their own): 46 distinct parents. Worker `cwd` equals that Mission's `workingDirectory` in all 842. For 32 parents the orchestrator `cwd` matches; for 14 it is a different ordinary absolute path, not under `~/.factory/worktrees`.
- Worker settings that were present show `autonomyMode` `auto-high` (842) and `toolExecutionMode` `direct_only` (796 of the files that had the key).

### Worktrees and branches

`-w` / `--worktree` is optional isolation for any `droid` or `droid exec` session. It is not how Missions place workers.

Published behavior ([CLI reference, Git worktrees](https://docs.factory.com/docs/droid-cli/cli-reference#git-worktrees); `worktreeDirectory` in [settings](https://docs.factory.com/docs/droid-cli/settings)):

- Default root is `~/.factory/worktrees`. Layout is `<root>/<8-character group>/<repository name>/`. The checkout is a real `git worktree` with its own branch.
- No name: docs say the branch is `<current-branch>-wt`. Installed `droid exec --help` says the default is `<current-branch>-<id>`. Those two descriptions disagree. It was not executed, so the runtime winner is unknown.
- A given name is the branch, created from `HEAD` if missing. If that branch is already checked out elsewhere, the command fails.
- Interactive: the worktree directory is kept after the session. `droid exec`: a clean worktree is removed on exit; a dirty one is kept and its path is printed. The git branch is never deleted.
- The binary's separate `[Daemon Worktree]` path archives sessions, broadcasts branch changes, and refuses to remove a worktree that still holds work (`Recovery preserved worktree holding work`, `Archived-session cleanup preserved worktree holding work`).

What the local Missions actually used:

- `~/.factory/worktrees` contained no worktrees (only a directory marker file).
- Every Mission `workingDirectory` (59/59) and every worker `cwd` (842/842) was an ordinary absolute path outside `~/.factory`.
- `worker_completed` `repoPath` equals that working directory in 459 events. 59 events name a different absolute path. Of those, 39 still share the working directory's git common dir (another checkout of the same repository), 18 are a different repository, and 2 paths are gone. None of the 59 sit under `~/.factory/worktrees` or under a directory named `worktrees`.
- One Mission directory contains an empty `worktrees/` child. No other Mission directory does.
- `git worktree list` on the 27 working directories that are still git repos: 20 have a single worktree, and the rest have 2, 4, or 26. Extra worktree paths were ordinary absolute paths. Branch names did not use a `-wt` suffix, a UUID, or the word `mission`. Those extra worktrees were not attributed to Missions.
- Workers do record commits: `worker_completed` includes `commitId` (git sha) and `repoPath`. That is a commit in the working checkout (or, in the 39 events above, in another checkout of the same repo), not a Mission-owned branch namespace.

### Lifecycle

Mission `state.json` values present now: `planning` 8, `awaiting_input` 6, `orchestrator_turn` 1, `paused` 8, `completed` 36. Feature statuses in `features.json`: `pending` 96, `in_progress` 3, `completed` 823, `cancelled` 42. The three `in_progress` features belong to paused Missions.

Full `progress_log.jsonl` event counts (46 files, 3986 lines): `worker_selected_feature` 835, `worker_started` 835, `worker_completed` 792, `worker_failed` 60, `worker_paused` 30, `mission_accepted` 47, `mission_run_started` 708, `mission_paused` 50, `mission_resumed` 39, `milestone_validation_triggered` 126, `handoff_items_dismissed` 464.

`worker_started` fields: `workerSessionId`, `spawnId`, `featureId`, `modelId`. `worker_completed` adds `exitCode`, `commitId`, `repoPath`, `successState` (`success`, `failure`, `partial`), `returnToOrchestrator`, `validatorsPassed`, and `handoff`. `worker_failed` adds `reason`, `failureReason`, `spawnId`. Every recorded `exitCode` was `0` (837). The short `failureReason` value in the corpus is `worker_exited_without_handoff` (45). Most spawn ids are 15-character tokens (843). Four use the prefix `daemon_process_exit_`. Two more start with `daemon_`.

Pause. Docs: the user pauses the orchestrator and talks to it ([overview troubleshooting](https://docs.factory.com/missions/overview), [CLI](https://docs.factory.com/docs/missions/running-cli), [Factory app](https://docs.factory.com/docs/missions/running-app)). Binary: an interrupt signal logs `Received interrupt signal, pausing...` and `pauseMissionRunner` tries to interrupt the worker session, both sync and async. Those interrupts can fail (`Failed to interrupt worker session`). `kill_worker_session` logs `Worker killed and feature requeued` and `Killed by user`. Automatic pause reasons visible as short tokens: `feature_retry_limit_exceeded` (4 local events) and, as a binary string, `scope_growth_limit_exceeded`. Most of the 50 `mission_paused` events have no short `pauseReason`.

Crash and the next start. A worker exit is a daemon notification, not a guess from a lost pipe. The runner ignores `PROCESS_EXIT_ERROR` when the worker already completed. Otherwise it records the unexpected exit. On a later start it can log `Found orphaned worker, attempting cleanup`, then `orphan_cleanup`, then `Pausing mission` / `worker_paused`. One local `reason` is `orphan_cleanup`. `reconcileMissionStateAfterSessionLoad` repairs stale state. `No state file found, stopping`. `State is Completed but pending features exist; resuming`. Resume loads the worker session (`Resuming worker session`, `Loaded worker session`) and `mission_resumed` may carry `resumeWorkerSessionId`.

There is also a stall path that is not an exit: `workerStartStallTimeoutMs`, `mission_heartbeat`, and the setting `subagentInactivityTimeout` ("Timeout in milliseconds for subagent inactivity before Droid treats the worker as stalled"). The timeout value and whether a stall kills the process were not recovered.

App quit. Not specified in the Mission docs. `keepSystemAwakeDuringMissions` defaults to true and, on macOS, runs `caffeinate -i -w <parent-pid>` until that pid is gone (`--why=Keep system awake during mission execution`). Linux uses `systemd-inhibit` or `gnome-session-inhibit`; Windows uses a thread-execution-state flag. The lock tracks the parent process. It does not say child workers are reaped. The daemon can watch its own parent via `--parent-pid` and `--liveness-fd`. The running daemon was a Factory-app child with no session children, so quit behavior for an in-flight worker was not observed.

### How liveness can be proven

Identity is `workerSessionId` (UUID), plus a `spawnId` string. It is stored on the feature (`workerSessionIds`, `currentWorkerSessionId`, `completedWorkerSessionId`) and on every worker progress event. `state.json` has no pid. `features.json` has no pid.

| Claim | What was actually there | Enough? |
| --- | --- | --- |
| Worker `exited` | `worker_completed` or `worker_failed` for that `workerSessionId`, or a daemon `session_process_exited` that the runner accepted | Yes, after the runner has recorded it |
| Worker `live` | A running Droid process that can be matched to that session id | Not from the files alone |
| Process gone, so `exited` | No pid in Mission state. Live `droid` argv, environ, and open files contained no Mission id and no worker session id (21 processes). Four of those processes merely shared a cwd with a non-completed Mission's working directory. The orchestrator, every worker, and a normal `droid` in that repo look the same | No. Absence is `unverifiable` |

`~/.factory/state/background-processes.json` does store `pid`, `parentPid`, `sessionId`, `command`, `cwd`, and `outputFile`, but its two live rows were not `droid` and their session ids were not worker ids. The top-level `background-processes.json` had an empty `processes` array. That file is not the Mission worker table.

Droid's own orphan pass is a reconciliation on the next runner start. It is not a license to treat "the orchestrator is gone" as "the worker exited" at the moment contact is lost.

### State left on disk

Kept after `completed` (36 Missions are still on disk):

- `~/.factory/missions/<uuid>/` including `state.json`, `working_directory.txt`, `features.json`, `progress_log.jsonl`, `worker-transcripts.jsonl` (keys only: `workerSessionId`, `featureId`, `milestone`, `skeleton`, `timestamp`), `handoffs/*.json`, `model-settings.json`, `validation-state.json`, `validation-contract.md`, `mission.md`, `AGENTS.md`, `architecture.md`, `services.yaml`, `init.sh`, `skills/`, `library/`, and often `validation/`, `evidence/`, `contract-work/`, `research/`.
- Worker session transcripts and settings under `~/.factory/sessions/<cwd-slug>/`.
- Git commits in the working repository (`commitId` on the handoff). No Mission branch is created or deleted by the `-w` rules, and none was identified here.
- `~/.factory/droids/scrutiny-feature-reviewer.md` and `user-testing-flow-validator.md` (product droids, not per-Mission).

Not evidence of Mission cleanup:

- `~/.factory/worktrees` was empty. `-w` would put checkouts there and would remove only a clean `droid exec` worktree. Dirty `-w` worktrees are kept on purpose. The branch remains either way.
- `~/.factory/mission-rehome/rehome.py` is a local script ("Copy an old-org mission folder into a freshly created new mission folder"). It rewrites a subset of Mission files and skips `worktrees/` and `rehome/`. Four Missions have `.rehomed-from.json` (`old`, `new`, `rehomedAt`, `counts`). That is a local move between Mission directories, not Factory's product cleaner.
- Shells a session starts can be listed in `background-processes.json`. They are separate from the worker process.

`init.sh` exists on 46 Missions (`#!/bin/sh`, `#!/usr/bin/env`, or `#!/bin/bash`). `services.yaml` has top-level keys `commands` and `services`. `library/environment.md` and `library/user-testing.md` differ per Mission (45 and 46 distinct hashes). They are generated project notes, not a shared runtime contract.

## Evidence log

- Docs, fetched this session: [overview](https://docs.factory.com/missions/overview), [planning](https://docs.factory.com/docs/missions/planning), [running in the CLI](https://docs.factory.com/docs/missions/running-cli), [running in the app](https://docs.factory.com/docs/missions/running-app), [reference](https://docs.factory.com/docs/missions/reference), [CLI reference](https://docs.factory.com/docs/droid-cli/cli-reference), [Droid Exec](https://docs.factory.com/docs/droid-exec/overview), [settings](https://docs.factory.com/docs/droid-cli/settings), [subagents](https://docs.factory.com/docs/harness/subagents).
- Commands: `droid --version` (0.238.0), `droid --help`, `droid exec --help`, `droid daemon --help`. `file ~/.local/bin/droid`.
- Read-only shape walk of `~/.factory` (`missions/`, `mission-rehome/`, `worktrees/`, `state/`, `logs/`, `droids/`, `sessions/`, `software-factory/`). JSON key unions and enum counts for `state.json`, `features.json`, `model-settings.json`, `validation-state.json`, `.rehomed-from.json`, `progress_log.jsonl` (types and structural fields only), handoff JSON keys, `background-processes.json`, `task-invocations.json`. Session `session_start` keys and cwd comparison. `git -C <working-directory> worktree list --porcelain` and `rev-parse --git-common-dir`, with paths reduced to buckets.
- Process table: `ps -axww` classified by argv0; `lsof -d cwd` and a full `lsof` scan for Mission and session files. No process was signaled.
- Binary: printable fragments around `MissionRunner`, `spawnWorkerSession`, `kill_worker_session`, `session_process_exited`, `Daemon Worktree`, and `caffeinate`.

## Unknowns and risks

- The worker spawn argv was not recovered. Evidence says "delegated Droid process" supervised by the daemon and spoken to as a JSON-RPC session (`--input-format stream-jsonrpc` sits next to the unexpected-exit string). It does not show the exact argument vector, working directory flag, or whether the orchestrator or the daemon is the direct parent.
- No on-disk pid or socket path maps `workerSessionId` to a live process. A host that can only see `ps` cannot prove `live`, and must not treat a missing process as `exited`.
- App quit while a worker is running was not observed. Parent-pid watches exist for `caffeinate` and for `droid daemon`; their effect on a delegated worker is unknown.
- Scrutiny's process shape is unknown. User-testing validators match Task subagents; `scrutiny-feature-reviewer` did not appear in `task-invocations.json`.
- Docs and `droid exec --help` disagree on the unnamed `--worktree` branch (`<current-branch>-wt` versus `<current-branch>-<id>`).
- 39 completion events used another checkout of the same git dir. Nothing in the Mission folder names those checkouts or says who created them.
- `subagentInactivityTimeout` and `workerStartStallTimeoutMs` exist. The duration and the stall action do not.
- Interactive Missions are normal `droid` processes. Sharing a repo cwd with a non-completed Mission does not identify the orchestrator (4 live processes did that, with no Mission id on the process).

## Confidence

| Finding | Confidence |
| --- | --- |
| Orchestrator is one Droid session; headless entry is `droid exec --mission` | high |
| Workers are delegated Droid processes with their own session files, not Task-tool invocations | high |
| Daemon supervises session process exit and can spawn `droid`; it is not the orchestrator | high |
| Exact parent/argv of a worker process | low |
| Workers run in the Mission working directory, not in `~/.factory/worktrees` | high |
| `-w` is a separate git worktree under `worktreeDirectory`, branch kept, clean exec worktree removed | high |
| Which `--worktree` default branch name 0.238.0 actually creates | low |
| Pause writes `mission_paused` and attempts to interrupt the worker; kill requeues the feature | high |
| Next start treats an orphaned worker as cleanup and pauses | medium (binary strings plus one local `orphan_cleanup` reason; not observed live) |
| App quit reaps workers | low |
| `workerSessionId` is the durable id; no pid is stored; absence of a process is not `exited` | high |
| User-testing validators are Task subagents of a worker; scrutiny's process is unknown | medium |
| Completed Missions leave the mission directory, session transcripts, and git commits in place | high |
