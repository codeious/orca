# What SessionStart do a plain Task subagent and /new fire in a Droid terminal session?

## Question

[How does Orca's Droid listener tell a pane's lead session from its Mission workers and subagents?](https://github.com/codeious/orca/issues/30) decided that a pane's lead session is the session of its latest `SessionStart` with no `calling_session_id`, and that a start carrying one marks a child. That rests on two shapes nobody had seen: a plain `Task` subagent outside a Mission, and `/new`. It also had no reading on the Droid floor (0.238.0). Does the key name the spawning session, and does `/new` start a session without it?

## Short answer

- **Every plain `Task` subagent start carried `calling_session_id`, and it named the session that spawned it.** 5 of 5 child starts, in 3 runs: 0.238.0 foreground, 0.238.0 background, 0.244.0 foreground. The key is only on `SessionStart` payloads. The child's other hooks have no such key.
- **So the mid-turn guard is dropped.** A start without `calling_session_id` always replaces the lead. ADR 0005 is updated.
- **`/new` and `/clear` are one command** (`/clear` is defined as an alias of `/new`, and both runs matched). They fire `SessionEnd reason=clear` for the old session, then `SessionStart source=resume` for a new id with **no `calling_session_id` key and no `previous_session_id` key**, then a late `SessionEnd reason=other` for the old id. The `droid` process is the same throughout. Identical on 0.238.0 and 0.244.0.
- **A subagent runs inside the TUI process.** Every hook of every run, lead and child, reported the same `droid` pid, and `ORCA_PANE_KEY` reached all of them. That holds for a background subagent too. Its shell commands are ordinary child processes of the TUI.
- **A background subagent outlives the lead's turn** (0.238.0): the lead stopped at +18.7 s, the child worked until +43.7 s, then the lead got an unprompted `UserPromptSubmit` (a wake-up turn) with its own session id.
- **`SubagentStop` names the spawner, not the child.** Its `session_id` is the lead's, and its keys are `cwd`, `hook_event_name`, `permission_mode`, `session_id`, `stop_hook_active`, `task_name`, `task_result`, `transcript_path`.
- **The two versions differ on the child's lifecycle** (table below), and the 0.244.0 shape breaks two parts of the rules decided so far. See "Shapes the current rules do not cover".
- **The on-disk fallback exists and was not needed.** The child's first transcript record has `callingSessionId` and `callingToolUseId`, and its settings sidecar has a `subagent` tag carrying the same two keys.

## Evidence

### Setup

- Droid 0.238.0 (the floor, from the pinned release used in earlier notes) and 0.244.0 (the installed release). macOS arm64 only. The terminal UI ran in a pty.
- A throwaway `HOME` per version. Its only Factory file is a `settings.json` with a hook on nine events (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `Notification`, `PreCompact`, `PreToolUse`, `PostToolUse`). `FACTORY_DISABLE_KEYRING=1` and `FACTORY_DROID_AUTO_UPDATE_ENABLED=false`. Every `ORCA_*` variable except `ORCA_PANE_KEY` was removed from the child environment. The real `~/.factory` was never touched.
- The hook logger (`probe/hook-log.py`) records the event, the payload's top-level **key names**, a few short allowlisted values (`source`, `reason`, `tool_name`, `agent_type`), an 8-character session id prefix, the **relation** between ids (`session_id`, `calling_session_id`, and `previous_session_id` become S1, S2, ... in order of first sight per run), the ancestor process names, whether `ORCA_PANE_KEY` was set, and `FACTORY_*` / `DROID_*` variable **names**. It never records prompts, tool input, messages, or paths. A self-test with planted strings confirmed that, and a scan of every output file for the API key value found none.
- Free runs: trust dialog accepted, no prompt submitted, then `/new`, `/clear`, Ctrl-C. These cost nothing.
- Paid runs, 3 of the 4 turns the user approved, on `gpt-6-luna` with reasoning effort `none` and autonomy `low`. The key came from a file the user named, into the child environment only.
  1. 0.238.0, foreground: the lead launches one built-in `explorer` subagent that answers one word.
  2. 0.244.0, foreground: the same prompt.
  3. 0.238.0, background: the lead launches one built-in `worker` with `run_in_background`, which runs `sleep 20` through `Execute`, and ends its turn without waiting.
- Cost, from the sessions' settings sidecars (`factoryCredits`): turn 1 about 1,117 (lead 800, child 317), turn 2 about 1,083 (lead 762, child 321), turn 3 about 1,237 (lead 869 including the wake-up turn, child 368). About 3,437 in all. I did not read the account balance.
- No Mission was started.

### `/new` and `/clear`

Same order on both versions (`hooks.jsonl`, tag `tui-<version>/f1-new-clear`).

| Step | Hook | Session | `calling_session_id` | `previous_session_id` | `droid` pid |
| --- | --- | --- | --- | --- | --- |
| start | `SessionStart source=startup` | S1 | absent | absent | P |
| `/new` | `SessionEnd reason=clear` | S1 | absent | absent | P |
| `/new` | `SessionStart source=resume` | S2 (new id) | absent | absent | P |
| `/new` | `SessionEnd reason=other` | **S1 (old id)** | absent | absent | P |
| `/clear` | `SessionEnd reason=clear` | S2 | absent | absent | P |
| `/clear` | `SessionStart source=resume` | S3 (new id) | absent | absent | P |
| `/clear` | `SessionEnd reason=other` | **S2 (old id)** | absent | absent | P |
| Ctrl-C | `SessionEnd reason=other` | S3 | absent | absent | P, then gone |

- The new session is `source=resume`, not `startup` and not `clear`. A rule must not key on `source`.
- Droid's code passes the replaced session to the hook as `previous_session_id`, but it never reached the payload. No hook names the session a `/new` replaced.
- The pid and start time were the same across `/new`, `/clear`, and the late `SessionEnd`.

### Foreground `Task` subagent

S1 is the lead, S2 the child. Seconds after the first hook. Every row came from the same `droid` pid.

| 0.238.0 (`p1-task`) | | 0.244.0 (`p2-task`) | |
| --- | --- | --- | --- |
| +14.4 | S1 `PreToolUse` (`Task`) | +14.6 | S1 `PreToolUse` (`Task`) |
| +14.5 | S2 `SessionStart startup`, **calling = S1** | +14.6 | S2 `SessionStart startup`, **calling = S1** |
| +14.6 | S2 `SessionStart resume`, **calling = S1** | | |
| +14.7 | S2 `UserPromptSubmit` | +14.7 | S2 `UserPromptSubmit` |
| +18.6 | S2 `Stop` | +17.6 | S2 `Stop` |
| | | +17.7 | S2 `SessionStart resume`, **calling = S1** |
| | | +17.9 | S2 `SessionEnd reason=other` |
| +18.9 | `SubagentStop`, session S1 | +18.0 | `SubagentStop`, session S1 |
| +19.0 | S1 `PostToolUse` (`Task`) | +18.1 | S1 `PostToolUse` (`Task`) |
| +22.2 | S1 `Stop` | +20.7 | S1 `Stop` |
| | no child `SessionEnd` | | |

- The child fires two `SessionStart`s with the same id in both versions. On 0.238.0 both come at the start. On 0.244.0 the second (`source=resume`) comes **after the child's `Stop`**, followed by the child's `SessionEnd`.
- The child's `SessionEnd` (0.244.0) has `reason=other`, no `agent_id`-style key, and the TUI's pid, while `droid` is alive.
- The child fires its own `UserPromptSubmit` and `Stop`. Only `SessionStart` has the `calling_session_id` key.

### Background `Task` subagent (0.238.0 only, `p3-bg`)

| Seconds | Hook |
| --- | --- |
| +15.4 | S1 `PreToolUse` (`Task`) |
| +15.5 | S2 `SessionStart startup`, **calling = S1** (the only start for S2) |
| +15.7 | S1 `PostToolUse` (`Task`): the call returns at once |
| +15.7 | S2 `UserPromptSubmit` |
| +18.7 | **S1 `Stop`**: the lead's turn ends |
| +19.9 | S2 `PreToolUse` (`Execute`) |
| +40.1 | S2 `PostToolUse` (`Execute`) |
| +43.7 | S2 `Stop` |
| +44.3 | `SubagentStop`, session S1 |
| +44.3 | **S1 `UserPromptSubmit`**: the lead wakes with no user prompt |
| +47.8 | S1 `Stop` |

- The child ran about 25 s after the lead's `Stop`.
- While it ran, the TUI's descendants were `bash`, `bash`, `sleep`, `sleep` (the `Execute` call). No second `droid` process exists.
- No child `SessionEnd`, no second child start, and no `Notification` at all in this run.
- An `afplay` process shows under the TUI shortly after a lead's `Stop` (probably Droid's end-of-turn sound, not checked). Ignore it when reading descendants.

### On disk (`sessions-shape.jsonl`, key names only)

- The child's first transcript record has `callingSessionId` (the lead's id) and `callingToolUseId`, in all three runs. The lead's has neither.
- The child's sidecar has tags `read-only` (for `explorer`) and `subagent`, and the `subagent` tag's metadata has `callingSessionId` and `callingToolUseId`. The sidecar has no top-level `callingSessionId`.
- The binary agrees: the Task path builds the child with `callingMetadata`, and a Mission worker gets the Mission id there instead.

## Decision for the guard

**Drop it.** The ticket's test was "if every subagent start carries `calling_session_id`, drop the guard". Every start did, on the floor and on a current release. A start with no `calling_session_id` always replaces the lead, which is what `/new` and `/clear` produce. ADR 0005 now says so.

No fallback is needed on the floor, because the key is there. If a later Droid drops it, the child's transcript `session_start` record (`callingSessionId`) and its `subagent` tag name the parent too, but both are file reads at hook time.

## Shapes the current rules do not cover

These come from the same runs. The first two are not covered by the child rule in ADR 0005 or by the Claude-shaped exit rule that [Does a Droid hook command's parent process identify the droid terminal process?](https://github.com/codeious/orca/issues/31) left open. The Droid listener is not built yet (`calling_session_id` appears nowhere in `src`), so these are gaps in the written rules, not bugs.

1. **A child `SessionStart` after the child's `Stop` (0.244.0).** ADR 0005 says a child's `Stop` removes its snapshot and keeps its id known, and that prompt and tool events mean `working`. It does not say what a `SessionStart` for a child that already stopped does. If a start creates a snapshot, the late one re-creates it, and nothing after it removes it: the child's `SessionEnd` is dropped and a lead `Stop` keeps children. The listener must ignore a start for an id it has already finished.
2. **A child `SessionEnd reason=other` that looks like the process ending (0.244.0).** Orca's exit rule in `src/shared/agent-hook-listener.ts` ends a row on a `SessionEnd` whose `reason` is `prompt_input_exit`, `logout`, `other`, or `bypass_permissions_disabled`, unless the payload has an `agent_id`. It runs for Claude only today. Droid's child `SessionEnd` has no `agent_id` (its keys are `cwd`, `hook_event_name`, `message_count`, `message_id`, `permission_mode`, `reason`, `session_duration_ms`, `session_id`, `transcript_path`), so the rule extended to Droid would end the terminal's row after every 0.244.0 subagent. The late `SessionEnd other` for the old id after `/new` is the same kind of event. Only a `SessionEnd` for the **current lead** can mean the process ended.
3. **A child that never ends (0.238.0).** No child `SessionEnd`, so `Stop` is the only end signal there.
4. **A background child outlives the lead's `Stop`.** The rule handles this (a lead `Stop` keeps children, and a row is not `done` while a child works). Two details: the row may read `done` for about 0.6 s between the child's `Stop` and the lead's wake-up `UserPromptSubmit`, and the lead's **idle `Notification` would drop a child that is still working** if Droid sends one during a long background run. No `Notification` fired in any of the 6 runs, including the 25 s gap, so the idle threshold is unknown.

## Not covered

- Background subagents on 0.244.0, and background runs longer than about a minute.
- Custom droids, `Task` with `resume`, two subagents in parallel, and an interrupt while a subagent runs.
- Mission workers and validators on these two versions. [What hooks and session metadata does a Mission produce inside a Droid terminal session?](https://github.com/codeious/orca/issues/24) saw `calling_session_id` on 0.242.1.
- Linux, Windows, WSL, and SSH. Hook payloads should not depend on the OS, but only macOS was run.
- Why some terminal starts run no `SessionStart` ([Does a Droid hook command's parent process identify the droid terminal process?](https://github.com/codeious/orca/issues/31)). All 6 terminal launches here ran one.

## Fixtures

- `research/droid-subagent-session-start/hooks.jsonl`: every hook record and process mark, one JSON object per line. `kind` is `hook` or `tui` (a mark of the TUI's descendants). `tag` is `tui-<version>/<run>`: `f1-new-clear` (free), `pre-paid-check` (free, flags only), `p1-task`, `p2-task`, `p3-bg` (paid).
- `research/droid-subagent-session-start/sessions-shape.jsonl`: the on-disk shape per session (key names, id relations, tag names, credits).
- `research/droid-subagent-session-start/probe/`: the logger, profile builder, key loader, run scripts, and renderers. `render.py hooks.jsonl <tag-prefix>` prints a timeline. The scripts expect `/tmp/droid-32` paths, `KEY_FILE` pointing at a file with a `FACTORY_API_KEY=` line, and the 0.238.0 binary at `/tmp/droid-31/bin/0.238.0/droid`.
- No key, home path, user name, prompt, or message is in any file.
