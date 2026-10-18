# Does the old session's SessionEnd `other` ever arrive before the new SessionStart on `/tree` and `/resume <id>`?

## Question

[Does a Droid terminal replace its session in place without a `SessionEnd` `clear`?](droid-session-replacement.md) found that `/tree` (both versions) and `/resume <id>` (0.244.0 only) swap the session inside the same `droid` process with no `reason=clear`. The order seen was `SessionStart` `source=resume` for the new session, then `SessionEnd` `reason=other` for the old one. That was one switch per command and version.

ADR 0007's exit rule ends a terminal's process only on a `SessionEnd` `other` for the pane's current lead that no `clear` has replaced. On `/new` and `/clear` the `clear` guards the order. On `/tree` and `/resume` nothing guards it except the new `SessionStart` arriving first. If the old session's `other` ever arrived first, the rule would end a live process.

1. Over at least 30 switches each, for 0.238.0 `/tree`, 0.244.0 `/tree`, and 0.244.0 `/resume <id>`: does the old session's `SessionEnd` `other` ever arrive at a listener before the new session's `SessionStart`? Arrival is the listener's `seq`, assigned when the POST body is read, not the order of lines in any file.
2. Does the `droid` process stay the same through every switch?
3. Was any inversion seen?

## Short answer

No inversion was seen.

- **180 switches, 0 inversions.** 60 per command and version, in 3 fresh processes of 20 switches each. Every switch produced exactly one `SessionStart` (`source=resume`) and then exactly one `SessionEnd` (`reason=other`) for the session just left, in that arrival order. The `SessionEnd` was always the very next arrival after the `SessionStart`.
- **No `clear` anywhere.** 0 of 180.
- **The process never changed.** The `droid` process behind every hook was the same for the whole run, in all 9 processes, and the terminal's own process was the same before and after each of the 180 switches. Each process then exited by itself on two Ctrl-C, with one final `SessionEnd` `other` for the session it was on.
- **No other hook.** Only `SessionStart` and `SessionEnd` fired. No `UserPromptSubmit`, no `Stop`, nothing that would mean a prompt was sent. The run was set to stop at once if one appeared.
- **How far apart the two hooks arrived.** The `SessionEnd` followed the `SessionStart` by 80 to 351 milliseconds, with a median of about 95 to 98. It was never at the same moment and never earlier. That gap is for the probe's own hook command and says nothing about another hook command (see Not covered).
- **`calling_session_id` was absent from all 180 new starts**, as before.

## Evidence

### Setup

- Droid 0.244.0 is the installed release. Droid 0.238.0 is the floor, local sha256 `f7e94ff10eda09b0d3140b258899af72aabc136634413e2f62a73a92e40f2afc`, checked before use. macOS arm64.
- Same probe as the earlier note: a local listener that numbers each POST when the body is read, a hook command that forwards only allowlisted fields, a throwaway `HOME` per process, a real key loaded from a file into the child environment only, `FACTORY_DISABLE_KEYRING=1`, auto-update off, every `ORCA_*` variable removed except `ORCA_PANE_KEY`. The key is not in this note, the logs, or the captures. The real `~/.factory` was not read or copied.
- Each process is a fresh signed-in `droid` under a PTY. Enter accepts the folder-trust dialog. Then `/fork` twice, so there are two other sessions to move between, and 20 switches that alternate between them.
- `/fork` fires no session hook and spends nothing. Its notice says you stay in the original session.
- Nothing was typed except `/fork`, `/tree`, `/resume <id>` (0.244.0 only), Enter, arrow keys, Escape, and Ctrl-C to exit. The driver refuses any other slash command, and refuses `/resume` on 0.238.0 in code.
- A hook row is kept as a relation only: session ids as `S1`, `S2`, and so on, process identity as `P1`. Relations start over inside each process.
- Earlier trial runs on 0.244.0 (about 50 switches while the keys were worked out) are not counted. They showed the same two hooks.

### How the command lists were checked before typing anything

| Source | 0.238.0 | 0.244.0 |
| --- | --- | --- |
| Command objects read from the binary with `strings`. The binary was run only for `--version` | `new`, `clear`, `fork`, `sessions`, `tree`. No `resume`. | The same, plus `resume`, described as "Resume a session by id, or list previous sessions" and marked as an alias of `sessions` |
| `droid --help` | Not run. Only `--version` | Subcommands and flags only. Slash commands are not listed |
| [CLI reference](https://docs.factory.ai/reference/cli-reference) slash command table | Lists `/fork`, `/tree`, `/sessions`, `/new`, `/clear`. It does not list a `/resume` slash command | Same page |

So on 0.238.0 only `/fork` and `/tree` were typed. `/resume` was never typed there. On 0.244.0 `/resume <id>` was typed only with a session id read from that process's own throwaway `HOME`. `/compress`, `/handoff`, and `/missions` were not run.

### How the switching was driven

The screen was read through a terminal emulator (`pyte`) after every key, not assumed.

- **`/tree`.** The tree lists the sessions of one fork family. The cursor starts on the row marked `← current`. The latest message of another session is the row marked with a filled dot and the session title (`●`). Right after the first fork the two sessions share their only row, so that one row carries both marks. To switch, the driver finds the dot row, presses Up or Down by the row difference, and presses Enter. A fixed "Down, Enter" is not enough: the tree gains about two empty rows with every switch, from 1 row at the first switch to 38 by the 20th, so the dot row moves, and it can sit above or below the cursor. The driver reads the screen after each press, and walks four rows at a time when the dot row is not on screen. Keys per switch ran from 0 to 22 on 0.238.0 and from 0 to 26 on 0.244.0.
- **Switching back.** The same rule works in both directions, because after each switch the other session is the one carrying the dot.
- **`/resume <id>`.** Alternates between the two forks. The ids come from the session files in the throwaway `HOME`, are held in memory, and are never printed or stored. The id is typed, the line is checked on screen, and then Enter.
- After every switch the driver waits for the two session hooks, waits for the screen to settle on the prompt, and checks that the terminal's own process (pid and start time) is the one it started. A switch that fails any of these stops the run.

### Counts

Each row is 3 processes of 20 switches. "Pairs" means exactly one `SessionStart` `resume` and exactly one `SessionEnd` `other` arrived for the switch, nothing else, and the ended session was the one the pane was on while the started one was a different session.

| Command | Version | Switches | Pairs | Old `other` before the new `SessionStart` | `clear` seen | Process changed | Back at a prompt | Other hooks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/tree` | 0.238.0 | 60 | 60 | 0 | 0 | 0 | 60 | 0 |
| `/tree` | 0.244.0 | 60 | 60 | 0 | 0 | 0 | 60 | 0 |
| `/resume <id>` | 0.244.0 | 60 | 60 | 0 | 0 | 0 | 60 | 0 |
| Total | | 180 | 180 | 0 | 0 | 0 | 180 | 0 |

Per process the arrivals were exactly: one startup `SessionStart`, then 20 times (`SessionStart` `resume`, `SessionEnd` `other`), then one final `SessionEnd` `other` for the last session on exit. 9 processes, 378 hook rows (9 + 180 + 180 + 9). The listener's `seq` ran 1 to N with no gaps and no repeats in each capture, and the arrival clock never ran backwards against `seq`.

### Arrival gap between the two hooks

| Command | Version | Fewest ms | Median ms | Most ms |
| --- | --- | --- | --- | --- |
| `/tree` | 0.238.0 | 84 | 95 | 203 |
| `/tree` | 0.244.0 | 80 | 98 | 352 |
| `/resume <id>` | 0.244.0 | 82 | 98 | 339 |

Measured from the listener's arrival time of the `SessionStart` to that of the `SessionEnd`. The two hooks are separate command runs launched by Droid. This test cannot tell whether Droid waits for the first to finish before it fires the second, which is why the gap is only reported, not relied on.

### Process identity

- The hook command finds its `droid` parent by pid and start time. All rows of each process carry one process relation (`P1`), including the startup row, the 40 rows of switching, and the exit row. 9 of 9 processes.
- The driver also compared the pid and start time of the PTY child before and after every switch. 180 of 180 the same.

### What else showed up

- **`previous_session_id` is the new session's fork parent, not "the session just left".** The earlier note read it as the old session. That held for its one switch because the new session was a fork of the old one. The runs have a chain: the original session S1, a fork S2 of it, and a fork S3 of S2. Moving down to a fork (S1 to S2, S2 to S3) it named the session just left. Moving back up (S3 to S2) it named the parent's own parent, S1, not the S3 just left. So it equalled the session just left in 33 of 60 switches per command and version. For each session it was the same value every time that session was started: 0 sessions with two different values. The session files on disk agree: one fork's header names a parent that has no file (the original), the other's names the first fork. The new start still never carried `calling_session_id`.
- **`/resume <id of the session you are already in>` fires a lone start.** Seen in 5 of 5 tries on 0.244.0 (3 on purpose, 2 by mistake while the driver was being built; none are among the 180 switches): one `SessionStart` `resume` for the same session id as the current one, no `previous_session_id`, no `calling_session_id`, and no `SessionEnd`. The process stayed. There is no old-session `other` to race, so it does not bear on the question, but a start can name the session the pane is already on.
- **The two mistaken tries are why the driver picks the fork by its file header** (the file that names a parent) instead of by file order.
- **Session files lag.** The original session's file can appear several seconds after the first fork, and a session left empty can have no file at all. The driver waits and reads the header rather than counting files.
- **Tree size grows with every switch** (about two empty rows each), so the number of key presses to reach the other session grows too.

## Not covered

- Orca's own hook command. The probe's hook command is a Python script and the gap above is for it. A faster or slower hook command, or several hooks configured for the same event, was not tested. The measurement shows the order at one listener under one hook command, not that the order is fixed by Droid.
- Switches that happen while the agent is working, or with a long conversation in either session. All sessions here were empty, because a conversation needs a prompt and a prompt can spend credits.
- `/tree` choices other than the latest message of another session, such as picking an earlier message in the same session, or any branch action.
- Choosing a row in `/sessions`, `/compress`, `/handoff`, and `/missions`.
- `droid --resume`, `droid --fork`, and `droid exec`, which start a new process.
- Whether the lead variable inside Orca moves on the new `SessionStart` or slightly later. Only hook arrival order was measured.
- Linux, Windows, WSL, and SSH. Only macOS was run. A listener across SSH sees hooks over a different path and could order them differently.
- Versions other than 0.238.0 and 0.244.0.

## Fixtures

- `research/droid-session-replacement/tree-resume-hooks.jsonl`: the 378 hook rows from the three captures, with a `capture` field added when they were combined. No raw session id, pid, prompt, key, or path.
- `research/droid-session-replacement/tree-resume-switches.jsonl`: 189 driver markers (180 switches and 9 exits), one per switch, with the `seq` range each covers.
- `research/droid-session-replacement/probe/tree_resume_switches.py`: the driver. Needs `pyte`, `KEY_FILE`, and the probe scripts under `$PROBE_ROOT/probe`. Refuses `/resume` on 0.238.0 and any slash command other than `/fork`, `/tree`, and 0.244.0 `/resume <id>`. Stops on any hook other than `SessionStart` and `SessionEnd`.
- `research/droid-session-replacement/probe/switch_order.py`: recounts from the listener's `seq`. Run `python3 research/droid-session-replacement/probe/switch_order.py --fixtures research/droid-session-replacement/tree-resume-hooks.jsonl research/droid-session-replacement/tree-resume-switches.jsonl` to reproduce the table above from the committed rows.
- Screen captures and the throwaway homes stayed in `/tmp` and are not in this commit. They were checked for the key, an email address, and a home path.
