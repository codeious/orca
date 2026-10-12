# What does a live Mission do when steered, killed, and observed?

Observed on Droid 0.238.0 (macOS arm64). One throwaway Mission ran in a scratch git repo under `/tmp`, started by hand with `/missions` in the interactive CLI. Scripted `stream-jsonrpc` and ACP sessions ran alongside and never became a Mission. Shapes only: no session or Mission ids, prompts, transcripts, or settings contents.

## Question

1. **Processes.** The parent of each worker process, the scrutiny validator's process, and how a `workerSessionId` maps to a process.
2. **Steering.** Whether a mid-run `missionSettings` update changes a live Mission, whether loading the orchestrator session restarts the runner, and whether the SDK's Mission notifications arrive.
3. **Death.** What happens to an in-flight worker when the parent `droid` is killed, and what the next start does.
4. **Checkouts.** Which worktrees, branches, and checkouts appear, and what created the extra same-repo checkouts seen on some worker completions.
5. **ACP.** Whether compact and permission requests appear only after a prompt.

## Short answer

In the interactive CLI, a Mission is one OS process. MissionRunner hosts each worker and validator as an in-process agent inside the TUI `droid`, logging `[Daemon] Hosting Droid agent in process`. No worker process exists, so every `workerSessionId` maps to the TUI's pid. The only extra process is `caffeinate -i -w <tui pid>`, which runs from planning until the Mission completes.

Workers commit on the current branch in the Mission's working directory. No worktree, branch, or extra checkout appeared.

A Mission cannot be started from a `droid exec` `stream-jsonrpc` session. The Mission tools are listed, but the model cannot load them, and `--mission` refuses streaming input.

ACP never offers compact. It sends a permission request only inside a prompt turn, and only when the autonomy level requires one.

Not observed: a mid-run settings change, killing the TUI mid-worker, and the scrutiny validator (the run used saved settings, which skip scrutiny).

## Findings

### Processes

- The user started `droid` from a login shell in an Orca pane. Its parent is that shell. Its environment carried the pane's variables (names seen: `ORCA_PANE_KEY`, `ORCA_TAB_ID`, `ORCA_WORKTREE_ID`, `ORCA_AGENT_HOOK_*`, and others).
- About two minutes in, when the Mission entered `planning`, the TUI started one child: `caffeinate -i -w <tui pid>`. It exited 2 s after the Mission reached `completed`.
- No other process appeared in the scratch repo during the run. `ps` was polled every 2 s, and each new process's cwd was checked with `lsof`. Over the run, two workers (about 50 s and 43 s) and one user-testing validator (about 11 min) worked in that repo.
- Droid's log shows the same thing for every worker, in order: `[MissionRunner] Spawning worker for next feature`, `[Daemon] Hosting Droid agent in process`, `[MissionRunner] Worker spawned with pre-assigned feature`, then `[MissionRunner] Worker completed successfully, continuing`. At run start, the log shows `[TuiDaemonAdapter] Opening in-process connection`. Worker log lines carry the TUI's process tags (`droidMode` `terminal-ui`, `isDroidExec` `false`). No `Delegated Droid process exited` line appeared.
- The user-testing validator was injected as a feature after `milestone_validation_triggered`. It ran in-process too and started two subagent sessions of its own.
- The scrutiny validator did not run. Saved `missionModelSettings` skip scrutiny, and the Mission used them, so its process shape is still unobserved.
- **`workerSessionId` to process.** All workers share the TUI pid. The TUI's argv is just `droid`, and `lsof` never caught it holding a session or Mission file open. A host can tie a TUI-hosted worker only to the TUI process. While that process is alive, Mission state decides whether a worker is running. Once it has exited, its in-process workers have exited with it (inferred from the shared process, not observed).
- This corrects [Where do Mission workers and validators run?](https://github.com/codeious/orca/issues/4) for the interactive CLI. That note inferred separate delegated processes from binary strings; none appeared here. Whether the Factory App or `droid daemon` path spawns separate processes is still open.

### Mission directory shape

- State went `planning`, `running`, `orchestrator_turn`, `completed`.
- Files written during planning: `state.json`, `working_directory.txt`, `mission.md`, `model-settings.json`, `progress_log.jsonl`, `features.json`, `validation-contract.md`, `validation-state.json`, `services.yaml`, `architecture.md`, `init.sh`, `AGENTS.md`, `library/environment.md`, `library/user-testing.md`, and `skills/<worker skill>/`.
- Files added at run start and during the run: `runtime-custom-models.json`, `worker-transcripts.jsonl`, `handoffs/<timestamp>__<feature>__<workerSessionId>.json`, `evidence/<milestone>/`, and `validation/<milestone>/`.
- `progress_log.jsonl` event types: `mission_accepted`, `mission_run_started`, `worker_selected_feature`, `worker_started` (with `modelId`), `worker_completed` (with `successState`), and `milestone_validation_triggered`.
- In `features.json`, a feature holds `currentWorkerSessionId` while running, then `completedWorkerSessionId` and `workerSessionIds`.

Timeline, from TUI start:

| Time | Event |
| --- | --- |
| +0:00 | TUI `droid` starts |
| +2:14 | `caffeinate` starts |
| +2:19 | Mission directory appears (`planning`) |
| +4:07 | `mission_run_started`; worker 1 hosted in-process |
| +4:58 | Worker 1 completes; worker 2 hosted |
| +5:41 | Worker 2 completes; validation injected; validator hosted |
| +16:42 | Validator completes; state `orchestrator_turn` |
| +17:37 | Orchestrator commits a docs change |
| +17:49 | State `completed` |
| +17:51 | `caffeinate` exits |

### Steering

- Not observed live. No settings change was made during the run.
- `model-settings.json` is written at Mission acceptance from the saved `missionModelSettings` (worker and validator model, effort, `skipScrutiny`, `skipUserTesting`). It did not change during the run.
- `runtime-custom-models.json` is written at run start; the log line is `[MissionFileService] Wrote runtime custom models`.
- Over `stream-jsonrpc`, `droid.initialize_session` accepts `interactionMode: "mission"` but drops `missionSettings`: the echoed settings omit it. `droid.update_session_settings` applies them, and `settings_updated` echoes all six fields. No Mission was created on that wire, so no `mission_*` notification was seen, and `droid.load_session` on a running Mission's orchestrator was not tried.

### Death

- Not observed. The TUI was not killed mid-worker.
- Workers are in-process, so killing the TUI ends them with it (inferred). `caffeinate` is tied to the TUI pid by `-w`.
- What the next start does (orphan reconciliation, pause) is still only what the earlier note read from the binary.

### Checkouts

- `git worktree list`, `git branch -a`, `~/.factory/worktrees`, and new `/tmp` entries were checked every 10 s.
- Only `main` and the one checkout existed. Each worker made one commit on `main`. The orchestrator added one docs commit after validation. The tree was clean at the end, and `~/.factory/worktrees` stayed empty.
- New `/tmp` entries during the run came from other work on the machine. None was a checkout of the scratch repo.
- The extra same-repo checkouts seen on earlier worker completions did not happen here. Their cause is still unknown.

### ACP

Three short `droid exec --output-format acp` sessions ran in a separate scratch folder.

- `initialize` advertises `loadSession`, `sessionCapabilities` `list` and `resume`, and image and embedded-context prompts. Compact is not advertised.
- `session/new` returns `modes` (`normal`, `spec`, `auto-low`, `auto-medium`, `auto-high`) and `configOptions` (`autonomy_level`, `model`, `reasoning_effort`).
- `available_commands_update` arrives 5–7 s after `session/new`. It lists only skills, with no `compact`, and the list does not change after a prompt.
- `/compact` sent as prompt text reaches the model as plain text, and nothing is compacted.
- No server request arrives while the session is idle. With autonomy `normal`, `session/request_permission` arrives inside the prompt turn, about 26 ms after the `tool_call` (status `pending`). Its options are `proceed_once` (`allow_once`), `proceed_always` (`allow_always`, "Allow & auto-run low risk commands"), and `cancel` (`reject_once`). At `auto-low` and `auto-medium`, the same command ran with no request, because the model rated it low risk.
- `--reasoning-effort` on the `droid exec` command line is ignored in ACP; the session keeps the saved effort. `session/set_config_option` with `reasoning_effort` `low` works. Autonomy values are mode ids (`auto-low`); plain `low` fails with `Invalid autonomy level value: low`.

### Mission tools outside the TUI

- `droid exec --mission` with a streaming input format fails with `Invalid flags: --mission cannot be used with streaming input formats.`
- In a `stream-jsonrpc` session with `interactionMode: "mission"`, `droid.list_tools` lists `propose-mission`, `start-mission-run`, `end-feature-run`, and `dismiss-handoff-items`. But the model's tool search for `ProposeMission` and `StartMissionRun` returned `Tool(s) not found`. Asked twice for a Mission, it wrote the code itself the first time, and the second time it reported that it had no Mission tools. Adding `decompSessionType: "orchestrator"` to initialize changed nothing.
- A binary fragment shows the ProposeMission confirmation returning false when `isNonInteractiveCLIMode()` is true.
- So the only headless Mission is the one-shot `droid exec --mission`, which matches [How does a client drive a Droid Mission?](https://github.com/codeious/orca/issues/3).

## Credits

`factoryCredits` from each session's settings file. The unit is not documented.

| Run | Units |
| --- | ---: |
| Scripted `stream-jsonrpc` session (no Mission; the model wrote two helpers itself) | 165,993 |
| No-prompt smoke and tool-list sessions (4) | 0 |
| ACP sessions (3) | 55,593 |
| Mission orchestrator, plus one subagent (37,402) | 382,167 |
| Mission workers (2) | 180,961 |
| Mission user-testing validator, plus two subagents (142,536) | 230,529 |
| **Total** | **1,015,243** |

The Mission alone cost 793,657 units over about 18 minutes. It used the saved settings: BYOK custom models, with the orchestrator, workers, and validator all at `xhigh` effort and scrutiny skipped. The agreed cap was 1,000,000 units. The total went 15,243 over, because the user ran the Mission by hand and the watcher only reported spend.

## State left behind

- `/private/tmp/orca-mission-probe`: the scratch repo, `main` only, six commits.
- `/tmp/orca-mission-probe-run`, `/tmp/orca-acp-probe-run`, `/private/tmp/orca-acp-probe`, and `/tmp/droid-sdk-types`: probe scripts, logs, and the SDK tarball. All are under `/tmp`.
- `~/.factory/missions`: one new Mission directory, state `completed`.
- `~/.factory/sessions`: 12 sessions under the scratch repo's folder and 3 under the ACP folder.
- Droid's own log lines in `~/.factory/logs`.
- No worktrees, no branches, no `~/.factory/worktrees` entries, and no probe processes. The user's TUI `droid` was still open at the end.

## Method

- A watcher took a process baseline first, so it ignored everything already running. Every 2 s it recorded new processes whose argv mentions `droid` or that run in the scratch repo: parent, cwd (via `lsof`), and Orca and Factory environment variable names only. Every 6 s it recorded the Mission directory's shape and summed `tokenUsage.factoryCredits` over sessions under the scratch repo's folder. Every 10 s it recorded git state and new `/tmp` entries.
- Scripted sessions stripped the Orca pane variables, so their hooks did not report to a live pane.
- The agent session's tool guard refuses to launch a Mission from a shell wrapper, so the user started the Mission with `/missions`.

## Unknowns and risks

- A mid-run Mission settings change, `droid.load_session` on a running Mission, and `mission_*` notifications on the wire.
- Killing the TUI mid-worker, and what the next start does.
- The scrutiny validator's process shape.
- Whether the Factory App or `droid daemon` hosts workers in-process or as separate processes.
- The cause of the extra same-repo checkouts.
- Workers started from an Orca pane run in that pane's process, so their hooks would fire with the pane's variables (inferred). Which Orca row their events land on was not checked.

## Confidence

- **High:** in-process hosting in the TUI (no new process in 2 s polling across about 13 minutes of worker time, plus explicit log lines), the ACP facts (frames captured), and the checkout facts.
- **Medium:** killing the TUI ending its workers. This follows from the shared process but was not observed.
