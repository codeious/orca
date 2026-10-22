# What does an interrupt do to a running Mission and its workers?

Observed on Droid 0.245.1 (macOS arm64). One throwaway Mission ran in a scratch git repo under `/tmp`, in a Droid terminal session inside an Orca pane. The person typed `/missions` and the plan by hand. The agent sent every key with `orca terminal send`, at moments chosen from hook and Mission-file events. Shapes only: no session or Mission ids, prompts, transcripts, or settings contents.

## Question

1. **Esc.** Whether one Esc, and two, pause a running Mission, and what that does to the worker or validator that is running.
2. **Ctrl+C.** Whether one Ctrl+C, and two, pause it, and whether either exits `droid`.
3. **Typed message.** Where a message submitted with Enter during a run lands.
4. **Signals.** Which hooks fire (`Stop`, `Notification`, `SessionEnd`) and what changes in the Mission files and child processes.
5. **Pause key.** Which keystroke Mission Control's Pause may send, and on which Droid versions.

## Short answer

**One Esc pauses the Mission and leaves `droid` running.** Within about a second the Mission is `paused`, the running worker or validator stops, and the terminal sits at an idle Mission prompt. A second Esc 300 ms later changes nothing. This held for a scrutiny validator and for an implementation worker. Typing "Continue the mission." resumed the same worker session.

**Ctrl+C is not a pause key.** One Ctrl+C prints `Press Ctrl+C again to exit.` and changes nothing else. Two Ctrl+C 500 ms apart pause the Mission and exit `droid`. A second lone Ctrl+C about 95 s after the first did not exit.

**A message submitted with Enter does not interrupt.** It shows under "Steering messages" and reaches the orchestrator only when the open `StartMissionRun` returns. Here that was 118 s later, after the remaining workers and the milestone validator finished.

**The hooks differ from what ADR 0005 assumes.** On an Esc pause the lead fires `Stop`, and the interrupted worker or validator fires `Notification` `idle_prompt`. The lead fires no `Notification`, the child fires no `Stop` or `SessionEnd`, and nothing fires `SessionEnd` at all. The child's `Stop` comes only after Continue, when it finishes.

**Pause may send one Esc, on 0.245.1.** 0.238.0 (the floor) and 0.244.0 were not run.

## Findings

### Cases

Each row is one send. "Seconds" are measured from the send. Mission-file and process events come from a 1 s poll, so they carry up to 1 s of slack. Hooks arrive at about 0.1 s resolution.

| Key sent | Running at the send | Result | `droid` | Hooks (seconds) |
| --- | --- | --- | --- | --- |
| Esc | Scrutiny validator, reviewers in flight | `paused` by 1.2 | alive | lead `Stop` 0.8; validator `Notification` `idle_prompt` 0.9 |
| Esc | Implementation worker | `paused` by 0.8 | alive | lead `Stop` 0.7; worker `idle_prompt` 0.7 |
| Esc, 300 ms, Esc | The same resumed worker | `paused` by 0.9, same as one Esc | alive | lead `Stop` 0.6; worker `idle_prompt` 0.6 |
| Text + Enter | Implementation worker | Not paused; message queued | alive | None for the message; lead `PostToolUse` `StartMissionRun` at 118 |
| Ctrl+C | Implementation worker | Not paused; no hook | alive | Tool hooks only |
| Ctrl+C, about 95 s after the one above | A worker finishing | Not paused; no hook | alive | Tool hooks only |
| Ctrl+C, 500 ms, Ctrl+C | Implementation worker | `paused` by 1.0 | **exited** | lead `SessionEnd` `reason=prompt_input_exit`, lead `Stop`, worker `idle_prompt`, all at 0.9 |

Across the run: four pauses, three Continues, one Mission, about 18 minutes.

### Esc

- On the first Esc the screen showed `Request cancelled by user` and the Mission input went idle.
- The Esc was one raw `0x1b` byte in one write. It worked the same on a validator whose reviewers were running and on an implementation worker.
- The Mission's wake-lock `caffeinate` child was gone within 1 to 2 s of each pause, and it was present again in later runs.
- The second Esc added no pause, no exit, and no extra hook.

### Ctrl+C

- One Ctrl+C (`orca terminal send --interrupt`, which appends `0x03`) prints `Press Ctrl+C again to exit.` as a line in the pane. Hooks, Mission files, and the running worker are untouched. The hint line stayed on screen for the full 45 s watched.
- A second lone Ctrl+C about 95 s later printed a second hint line and did not exit. So the "again" window is shorter than 95 s. It is not bounded below 0.5 s: two presses 500 ms apart exited.
- Two presses 500 ms apart pause the Mission as an Esc does, then exit `droid`. The watcher saw the process gone at its first poll after the lead's `SessionEnd`. The pane printed `To resume this session, run: droid --resume <orchestrator session id>`.
- The exit left the Mission `paused` on disk, with the interrupted feature still `in_progress` and holding its `currentWorkerSessionId`. A killed Mission in the earlier run stayed `running` until a resume reconciled it, so this is a different on-disk state. Resuming after this exit was not run.

### A message typed during a run

- Text plus Enter while a worker ran did not pause anything. The screen showed it in a block titled `Steering messages`, with hints for Ctrl+R, Ctrl+G, and Ctrl+X. The footer reads `Enter to steer · Ctrl+Enter to queue`.
- It stayed queued while three workers and the milestone validator ran. The lead's `StartMissionRun` returned at 118 s, as the validator stopped (118 to 119 s). The lead's first tool calls came 12 s after that, and it added a feature that exports every helper from `src/index.js`.
- The lead fired no `UserPromptSubmit` for the message. It reached the orchestrator inside that turn (inferred from order).
- It did not land between the worker's tool calls, unlike a structured session's `end_of_turn` steer. `Ctrl+Enter` ("queue") was not tried.

### Hooks on an interrupt

- **Lead.** `Stop` on every Esc pause and on the double Ctrl+C. No lead `Notification` fired at any interrupt. The only lead `Notification`s in the whole run were `elicitation_dialog` and `permission_prompt` during planning.
- **Interrupted child.** `Notification` with `notification_type=idle_prompt`, carrying the worker's or validator's own session id. It fired on all four pauses.
- **No child `Stop` or `SessionEnd` at the pause.** A paused child's `Stop` and `SessionEnd reason=other` came later, when it finished after Continue. The resumed worker fired no second `SessionStart`.
- **`SessionEnd`.** None on an Esc pause. On the double Ctrl+C the lead fired `SessionEnd` with `reason=prompt_input_exit`. The other 15 `SessionEnd`s in the run were `reason=other`, from sessions that finished.

### Mission files after a pause

- `state.json` holds `state: paused`. Its keys are `createdAt`, `initialFeatureCount`, `lastReviewedHandoffCount`, `missionId`, `state`, `updatedAt`, `workingDirectory`. There is no reason field.
- `progress_log.jsonl` gets `worker_paused` (keys `featureId`, `timestamp`, `type`, `workerSessionId`) and then `mission_paused` (keys `timestamp`, `type`), about 0.03 s apart. A Continue adds `mission_resumed` with `resumeWorkerSessionId` and a new `mission_run_started`. No other file under the Mission directory mentions a pause or a reason for one.
- The interrupted feature stays `in_progress` with its `currentWorkerSessionId` unchanged. After the last pause (the double Ctrl+C) no handoff existed for it.
- A Continue resumes the same worker session: the paused worker had one `SessionStart` and one `Stop`, with two pauses between them.

### Conflicts with earlier decisions

These are readings of the ADRs against the shapes above, not runs of Orca's listener.

- **ADR 0005, interrupt signal.** It says the lead's idle `Notification` is Droid's signal after a user interrupt and drops the interrupted turn's child snapshots. In a Mission the lead fires `Stop`, not an idle `Notification`, and the idle `Notification` is the child's. ADR 0005 keeps children across a lead `Stop` and drops child `Notification`s, and a paused child fires no `Stop`. So a paused Mission's row would stay `working` until Continue.
- **ADR 0007, exit reason.** Only `SessionEnd reason=other` starts the exit watch, and any other reason is dropped. The double Ctrl+C sent `prompt_input_exit`. The ADR expects `other` at Ctrl-C.
- **ADR 0008, pause reason.** It lists the pause reason among the Mission-file details. A user pause records none in `state.json` or the progress log. Other pause causes (retry or iteration limits) were not produced.

## Credits

`factoryCredits` summed over the Mission's sessions (30: orchestrator, workers, validators, and their subagents). The unit is not documented.

| Run | Units |
| --- | ---: |
| Whole run (about 18 minutes) | 95,849 |

The agreed cap was 300,000, with the watcher set to kill `droid` at 285,000 after checking the process name. Every role used one custom Haiku model at low effort, scrutiny on, user testing off.

The watcher was not running for the first 3 minutes of the Mission. A `pgrep -f` check matched its own command line and reported it alive. The cap was unenforced for that stretch, and the total stayed far below it. After the restart it logged every second.

## State left behind

- `/private/tmp/droid-mission-interrupt`: the harness scripts, the hook, watcher, and action logs (shapes only), and the scratch repo `work/` (`main` only, one commit per worker or fix).
- The throwaway `HOME` held a copy of the BYOK model entry from the real settings (mode 600). It was deleted after the run, with the Mission directory and sessions in it. The note's numbers come from the logs, which were kept.
- The scratch repo is still registered in Orca. The `orca repo` command has no remove, so it has to come out in the app.
- The real `~/.factory` was read to build the profile and never written. The person's Factory key file was read for the key and never sourced.
- `/usr/local/bin/orca` was unreadable on this machine, so the bundled launcher in `Orca.app/Contents/Resources/bin` was used. The symlink was not changed.
- No processes remain from the run.

## Method

- **Profile.** A throwaway `HOME` with one custom Haiku 5.5 model at low effort for the orchestrator, workers, validators, subagents, and compaction. Orca's managed `droid-hook.sh` plus a logger ran on every hook. The logger wrote event name, session id, parent id, tool name, notification type, reason, and source, but no payload text.
- **Launch.** The person ran `sh launch.sh` in an Orca pane, which exports the key from the dotenv file without sourcing it and runs `droid`. The agent found the pane's terminal handle from the `droid` process's Orca environment.
- **Watcher.** Polled every second: credits, Mission file shapes (key names and scalars), `progress_log.jsonl`, child processes of `droid`, and whether `droid` was alive.
- **Driver.** One script per case. It waited for the target (a running worker or validator, from `progress_log.jsonl`), sent the keys through `orca terminal send` (`--text` with a raw ESC, `--interrupt` for Ctrl+C, `--text --enter` for a message), and saved the pane's screen at +0, +3, +15, and +45 s.
- `orca terminal send` reported `inputAccepted` and `submitted` as null even when `ok` was true, so delivery was judged from the screen and the hooks.
- The agent never started the Mission. A guard refuses that from the agent's shell, so the person typed `/missions`.

## Unknowns and risks

- **Versions.** Only 0.245.1. The 0.238.0 floor and 0.244.0 were not run.
- **Esc outside a run.** Not tried while the lead waits on `AskUser` or `ProposeMission`, during the orchestrator's own turn, or between runs. In a dialog it may cancel the dialog.
- **Esc with a queued message.** Not tried. A structured session discards a pending steer on interrupt.
- **Redirect after a pause.** Only "Continue the mission." was typed after a pause, and text that changes the plan was not. `Ctrl+Enter` was not tried either.
- **Resume after the double Ctrl+C.** Not run, so whether a relaunched `droid --resume` continues the `paused` Mission is unknown.
- **The Ctrl+C window.** Between 0.5 s and 95 s. Whether Esc disarms it was not tried.
- **Long tools.** The tool calls in flight at each key were short. A long shell command in the worker at the moment of the key was not tried.
- **Reviewer subagents.** The hooks of a paused validator's reviewer subagents were not examined.
- **Hosts.** macOS, local pane, one run. SSH, WSL, Windows, and Linux were not run.
- **Exit reasons.** `prompt_input_exit` was seen once. The reasons for `/exit`, SIGTERM, and SIGHUP were not measured.

## Confidence

- **High:** one Esc pauses without exiting `droid` (three trials, on a validator and on a worker); one Ctrl+C neither pauses nor exits (two trials); two Ctrl+C 500 ms apart pause and exit (one trial); the hook set on each (all trials); no pause reason on disk.
- **Medium:** a typed message waits for the open `StartMissionRun` (one trial, one message); a Continue reuses the worker session (two trials).
- **Inferred, not run:** the effect on Orca's row under ADR 0005, and the message reaching the orchestrator without a `UserPromptSubmit`.
