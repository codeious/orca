# Droid Mission client surface

## Question

Which published client surfaces can start a Droid Mission, plan it, approve it, follow progress, pause, redirect, resume, change orchestrator/worker/validator models, and resume a past Mission? Cover the interactive CLI, `droid exec --mission`, stream JSON-RPC and the SDKs, and the on-disk `~/.factory/missions/<id>/` files.

## Short answer

The interactive CLI and the Factory App are the only published way to drive a Mission through planning, approval, progress, pause, redirect, and resume. `droid exec --mission` starts one non-interactive run and auto-approves it; it is not a control channel. JSON-RPC has no mission-control methods. Progress and plan approval exist only as typed notifications and permission requests, and the public exec/SDK guides do not mention them. Worker and validator models are published settings and exec flags; the TypeScript SDK also types them on `droid.update_session_settings`. The mission directory is unpublished local state with no schema version. Reading it is not a control API, and writing it is not a way to drive a Mission.

## Findings

Surfaces compared:

- **TUI** — interactive `droid`, Droid 0.238.0 help and the CLI reference.
- **exec** — `droid exec --mission`.
- **JSON-RPC / TS SDK** — `@factory/droid-sdk` 0.9.1 declarations (`dist/index-C06W9tbN.d.ts`, `dist/node.d.ts`). "Typed" means present in that package and absent from the public docs.
- **Python SDK** — `droid-sdk` 0.5.0. It is behind the TypeScript package.
- **App** — Factory App Mission Control.
- **Disk** — `~/.factory/missions/<id>/` as written by the local CLI. Shapes only; no ids, paths, prompts, or transcripts.

Labels: **published** (docs or `droid --help`), **typed** (SDK package only), **absent** (no control).

| Action | TUI | exec --mission | JSON-RPC / TS 0.9.1 | Python 0.5.0 | Factory App | On disk |
| --- | --- | --- | --- | --- | --- | --- |
| Start / enter planning | **Published.** `/missions` (alias `/mission`) starts a planning conversation. Mission Mode is not on the Shift+Tab cycle. | **Published.** `--mission` plans and executes with no live TUI. Requires `--auto high` or `--skip-permissions-unsafe`. One-shot: the process exits when the run ends. | **Typed, not a start method.** No `droid.start_mission`. `droid.initialize_session` and `droid.update_session_settings` accept `interactionMode: "mission"` (`"agi"` is a deprecated alias). `createSession` forwards `interactionMode` but not `missionSettings`. Docs for `sessionDefaultSettings.interactionMode` list only `auto` and `spec`. | **Absent on the high-level API.** `Mode` is only `auto`/`spec`. Low-level `DroidInteractionMode` is `auto`/`spec`/`agi`, with no `"mission"`. | **Published.** Mode selector, or start from the Mission Control page. Can target a remote Droid Computer. | **Absent.** Files appear after a mission exists. No writer API. |
| Plan | **Published.** Back-and-forth conversation, then features and milestones. Not a one-shot prompt. | **Published as part of the one-shot.** No separate planning turn is documented. | **No plan method.** The closest published call is `droid.add_user_message`. Whether that continues mission planning is not specified. | Same, if the server is already in a mission. The client cannot select the mode. | **Published** as part of starting a mission. No separate planning API. | **Not a control.** `mission.md`, `features.json`, and `architecture.md` are products of planning. |
| Approve the plan / start the run | **Published as a user approval** before Mission Control. The permission types behind it are not named in the docs. | **Published auto-approve.** High autonomy or `--skip-permissions-unsafe` is required so the orchestrator does not stop for prompts. | **Typed.** Server requests `droid.request_permission` with `propose_mission` or `start_mission_run`. A client answers like any other permission. No dedicated approve method. | **Low-level schemas include those confirmation types. The high-level `ToolConfirmationType` omits them.** | **Published** by starting or resuming from Mission Control. No approve endpoint is documented. | **Absent.** |
| Follow progress | **Published.** After approval, Mission Control is the orchestration view. `Ctrl+T` toggles that overlay for orchestrator sessions only. | **Not documented.** Published stream events are assistant text, tool events, token usage, errors, and turn completion. Mission events are not in that list. | **Typed notifications, hidden from the default stream.** `mission_state_changed`, `mission_features_changed`, `mission_progress_entry`, `mission_heartbeat`, `mission_worker_started`, `mission_worker_completed`. The TS mapper emits `DroidMessageType.Mission*` only when `includePartialMessages` is true, or via `onNotification`. | **Low-level schemas include the same notifications. The high-level stream does not convert them.** | **Published.** Time, credits, progress log, features, worker terminals. | **Unpublished snapshot.** `state.json`, `features.json`, and `progress_log.jsonl`. See below. |
| Pause | **Published.** Pause by talking to the orchestrator. No slash command. | **Absent.** | **Absent.** No pause method. `droid.add_user_message` is the generic turn API; the docs do not say a message pauses a mission. `MissionPauseReason` includes `user_requested`, which only shows that a reason exists. | **Absent.** | **Published.** Pause from the dashboard. | **Record only.** `state` can be `paused`. A `mission_paused` log line can carry `pauseReason`. |
| Redirect | **Published.** Talk to the orchestrator and ask it to re-plan. | **Absent** mid-run. A later `droid exec --session-id` continues a session; it is not documented as a mission redirect. | **No redirect method.** Same caveat as pause: only `droid.add_user_message`. | **Absent.** | **Published.** Pause, instruct, resume. | **Absent.** |
| Change orchestrator model | **Published defaults** via `missionOrchestratorModel` and `missionOrchestratorReasoningEffort`. `/model` switches the session model between turns; the docs do not say it retargets a running mission. | **Published.** `-m` / `-r` apply to the orchestrator. Worker and validator flags do not. | **Typed as the ordinary session model** (`modelId` on settings update). `missionSettings` has no orchestrator field. Mid-run effect is undocumented. | **High-level `update_settings(model=...)` exists.** It is not mission-specific. | **Published.** Orchestrator dropdown, on the fly. | **Absent.** `model-settings.json` has no orchestrator field. |
| Change worker / validator models | **Published defaults** in `missionModelSettings` (`workerModel`, `workerReasoningEffort`, `validationWorkerModel`, `validationWorkerReasoningEffort`, `skipScrutiny`, `skipUserTesting`). | **Published per run** via `--worker-model`, `--worker-reasoning-effort`, `--validator-model`, `--validator-reasoning-effort`. | **Typed.** `update_session_settings.missionSettings` has those six fields. `createSession` does not. Whether a running mission honors a mid-run update is undocumented. | **Absent.** Low-level `update_session_settings` has no mission-settings argument. | **Published.** Worker and Validator dropdowns, on the fly. | **Mirror, not a control.** `model-settings.json` stores the same six fields. |
| Resume this run | **Published** by continuing the orchestrator conversation. | **Not as a mission control.** `--session-id` / `--fork` continue a session and still exit after one pass. | **Typed only as generic session resume** (`droid.load_session` / `resumeSession`). Load does not take `interactionMode` or `missionSettings`. | Same generic resume. | **Published.** Pause then resume from the dashboard. | **Does not resume execution.** |
| Resume a past Mission | **Not separately documented.** `droid --resume` and `/sessions` resume sessions. `Ctrl+T` works only on an orchestrator session, which is a hint, not a resume-mission contract. | **Absent.** | **Discovery is typed; restart is not.** Session metadata has `decompSessionType` (`orchestrator` or `worker`) and `decompMissionId`. Nothing documents that loading the orchestrator session restarts the runner. | **Not in the 0.5.0 high-level surface checked here.** | **Published.** Mission Control tab lists past missions and resumes where they left off. | **Persists.** Completed missions still have the directory. Reading it does not restart anything. |
| Kill one worker | **Not documented.** | **Absent.** | **Typed.** `droid.kill_worker_session` `{ workerSessionId }`. Also `daemon.kill_worker_session`. Effect on mission state is undocumented. Not a pause or redirect. | **Low-level client has `kill_worker_session`.** | **Not documented.** The dashboard can inspect a worker. | **Absent.** |

### What requires Droid's own terminal

These have no published non-TUI equivalent:

- `/missions` and `/mission`.
- `Ctrl+T` Mission Control overlay.
- The documented "talk to the orchestrator" pause and redirect.
- Interactive plan review. A JSON-RPC client can answer `propose_mission` / `start_mission_run` itself, but that permission flow is not in the public docs. `droid exec --mission` skips it by auto-approving.

The Factory App covers start, resume, models, pause, and redirect without the terminal. That is a product UI (`app.factory.ai/missions`), not a client API. Remote Droid Computers are selected in that UI. No remote mission-control RPC is documented.

### JSON-RPC: what exists, and what does not

No `droid.*` method name contains `mission`. The typed mission surface is:

- Settings and init: `interactionMode` including `mission`, and `missionSettings` (worker model, worker reasoning, validation model, validation reasoning, `skipScrutiny`, `skipUserTesting`).
- Notifications listed in the table above. The state snapshot carries `state`, `updatedAt`, `title`, `workingDirectory`, `features`, `progressLog`, `workerSessionIds`, `workerStates`, `tokenUsage`, and `tokenUsageBySessionId`. That snapshot is not the on-disk `state.json`.
- Permission details `propose_mission` and `start_mission_run`.
- `droid.kill_worker_session`.
- Daemon-only, and not a way to drive a mission: `daemon.inspect_mission_readiness` and `daemon.acknowledge_mission_readiness_warning`.

`MissionState` in TS 0.9.1: `planning`, `awaiting_input`, `initializing`, `running`, `paused`, `orchestrator_turn`, `completed`. Python 0.5.0's enum has no `planning`.

Public exec JSON-RPC docs name `droid.initialize_session`, `droid.load_session`, `droid.add_user_message`, `droid.session_notification`, `droid.request_permission`, and `droid.ask_user`, plus a general "update settings". They do not name mission notifications, `missionSettings`, or the two mission permission types. The TypeScript and Python SDK guides, as linked from that page, document interaction modes as Normal/Spec only.

### On-disk shapes

Observed on this machine under `~/.factory/missions/<id>/`: 59 mission directories. Counts are how many directories contained the file. No values, ids, paths, or file contents were copied. The settings reference does not mention this directory. Nothing in the docs says a client may write it. There is no schema version field. Treat it as internal runtime state.

Stable top-level files:

| File | Present | Shape |
| --- | --- | --- |
| `state.json` | 59 | Object: `missionId`, `state`, `workingDirectory`, `createdAt`, `updatedAt` (strings); `initialFeatureCount`, `lastReviewedHandoffCount` (ints); `featureRetryBudgetBonus` (map of feature id to int). Observed `state`: `planning`, `awaiting_input`, `orchestrator_turn`, `paused`, `completed`. TS also declares `initializing` and `running`; those were not in this set. This is not the wire snapshot: no `title`, `features`, `progressLog`, workers, or token usage. `featureRetryBudgetBonus` is not in the TS 0.9.1 declarations. |
| `working_directory.txt` | 59 | One text line. Same role as `state.workingDirectory`. |
| `model-settings.json` | 47 | The six `missionSettings` fields. Strings for the two models and two reasoning efforts; bools for `skipScrutiny` and `skipUserTesting`. No orchestrator model. |
| `features.json` | 46 | `{ features: [...] }`. Each feature has `id`, `description`, `status`, `skillName`, `preconditions`, `expectedBehavior`, `verificationSteps`, optional `fulfills` and `milestone`, plus worker session ids. Observed `status`: `pending`, `in_progress`, `completed`, `cancelled`. TS also declares `blocked`, `failed`, `needs_review`. `verificationSteps` is on disk and in Python 0.5.0, and is absent from the TS 0.9.1 `MissionFeature` schema. |
| `progress_log.jsonl` | 46 | One progress entry per line. Observed `type`: `mission_accepted`, `mission_paused`, `mission_resumed`, `mission_run_started`, `worker_started`, `worker_selected_feature`, `worker_completed`, `worker_failed`, `worker_paused`, `handoff_items_dismissed`, `milestone_validation_triggered`. `mission_paused` includes `pauseReason` (sample: `feature_retry_limit_exceeded`; the TS enum also has `user_requested`, `orchestrator_iteration_limit_exceeded`, `validation_iteration_limit_exceeded`). `mission_resumed` includes `resumeWorkerSessionId`. `worker_started` includes `modelId`. `worker_completed` includes `successState` (`success`, `partial`, `failure`), `handoff`, and optional `repoPath`. `worker_failed` includes `reason` and `failureReason` (sample: `worker_exited_without_handoff`). Handoff objects carry verification, tests, discovered issues, and skill feedback. |
| `worker-transcripts.jsonl` | 44 | Records with string `workerSessionId`, `featureId`, `milestone`, `skeleton`, `timestamp`. `skeleton` is transcript text, not a control field. |
| `validation-state.json` | 46 | `{ assertions: { <id>: object } }`. Assertion objects include `status`, `validatedAt`, `validatedAtMilestone`, `flowReport`, and evidence fields. Ids and evidence are mission-specific. Not part of the JSON-RPC mission snapshot. |
| `services.yaml` | 46 | Two top-level maps: `commands` (name to a shell string) and `services` (name to an object with `start`, `stop`, `healthcheck`, `port`, `depends_on`). Values are task-specific. |
| `mission.md`, `AGENTS.md`, `architecture.md`, `validation-contract.md`, `init.sh` | 43–46 | Prose and shell the mission writes for workers. Not a schema. |
| `runtime-custom-models.json` | 45 | Custom model records (`id`, `provider`, `model`, `baseUrl`, `displayName`, and related flags). Records can include a credential field. Not a control surface. |

Common subdirectories, not a client API: `library`, `skills`, `handoffs`, `validation`, `evidence`, plus task-specific work trees. A few directories have `.rehomed-from.json` (`old`, `new`, `rehomedAt`, `counts`), an internal relocation marker.

Stability: **low**. TS 0.9.1, Python 0.5.0, and these files disagree on the mode name (`mission` vs `agi`), on `MissionState.planning`, on `verificationSteps`, and on `featureRetryBudgetBonus`. No version field. Do not build a client on this directory.

### SDK skew that matters for a client

- TS 0.9.1 can set `interactionMode: "mission"` and `missionSettings`. Python 0.5.0's high-level `Mode` cannot, and its settings update does not send mission settings.
- TS default `session.stream()` drops mission notifications unless `includePartialMessages: true`. They are always available on `onNotification`. Python's high-level stream never maps them.
- `killWorkerSession` is on `DroidClient` in the TS package, not a `DroidSession` method. Python exposes it on the low-level client.
- `listSessions` metadata includes `decompMissionId` and `decompSessionType`, so a TS client can tell an orchestrator session from a worker session. That does not resume the mission runner.

## Evidence log

- Factory docs, fetched 2026-09-27: [Factory Missions](https://docs.factory.ai/cli/features/missions), [Running in the CLI](https://docs.factory.ai/missions/running-cli), [Running in the Factory App](https://docs.factory.ai/missions/running-app), [Missions reference](https://docs.factory.ai/missions/reference), [Interaction Modes](https://docs.factory.ai/autonomy-and-safety/specification-mode), [Droid Exec](https://docs.factory.ai/droid-exec/overview), [CLI reference](https://docs.factory.ai/reference/cli-reference). Canonical links on those pages use `docs.factory.com`.
- Local `droid` 0.238.0, `droid exec --help`: `--mission` requires `--auto high` or `--skip-permissions-unsafe`; worker and validator model flags are valid only with `--mission`.
- `@factory/droid-sdk@0.9.1` type declarations, unpacked outside this repo. Method inventory: no `droid.*` method whose name contains `mission`. Notification and settings names cited above are from those declarations.
- `droid-sdk==0.5.0` wheel (PyPI), unpacked outside this repo. High-level `Mode` and `update_settings` inspected in `_high_level/enums.py` and `_high_level/_session_operations.py`. Low-level mission schemas in `droid_sdk/schemas/mission.py` and `schemas/enums.py`.
- Read-only structural pass over local `~/.factory/missions` (59 directories). Keys, types, enum samples, and file counts only.

## Unknowns and risks

- Setting `interactionMode` or `missionSettings` on an already-running mission is accepted by the TS types. The docs do not say the orchestrator picks the change up. The App dropdowns are the only published "on the fly" model control.
- `droid --resume`, `droid.load_session`, and `resumeSession` are generic session resume. Nothing documents that they restart the mission runner from the on-disk files.
- `droid exec` might still emit the typed mission notifications on stdout. They are not in the published event list, and this research did not run a mission to check.
- Which `MissionState` values accept a user message, and whether that message pauses, redirects, or only queues until `awaiting_input`, is not specified.
- `droid.kill_worker_session` is typed and undocumented. It is not a substitute for pause or redirect.
- Daemon readiness inspect/ack is a warning gate, not a start API.
- The on-disk format has already drifted between Python 0.5.0, TS 0.9.1, and Droid 0.238.0. A client that parses it will break across CLI updates.
- `runtime-custom-models.json` can hold credentials. It is unrelated to driving a mission.

## Confidence

**High** that the TUI and the Factory App are the published drive surface, that `droid exec --mission` is a one-shot auto-approved start, and that JSON-RPC has no mission control methods. **High** that the mission directory is unpublished and unstable. **Medium** on mapping "talk to the orchestrator" to `droid.add_user_message`, because the docs never name that method. **Low** on any claim that a settings update or a session resume actually steers a live or past mission: that behavior was not executed, on purpose.
