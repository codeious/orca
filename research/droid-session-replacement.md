# What do SessionEnd and SessionStart fire when a Droid terminal replaces its session in place?

## Question

[How does Orca's Droid listener read SessionEnd and late or missing session hooks?](https://github.com/codeious/orca/issues/33) decided that a Droid `SessionEnd` ends a terminal's process only when all of these hold: it carries the identity of the row's owner process, its `session_id` is the pane's current lead, its `reason` is `other`, and an earlier `reason=clear` has not already replaced that lead. `clear` (from `/new` and `/clear`) only marks the lead replaced. A row marked ended drops every later hook from that process, so a wrong exit blanks a live pane. ADR 0007, "Orca keeps one writer per Droid session among the writers it can see", records that rule.

The rule rests on two things seen in few runs. This note checks them.

1. Is `/new` or `/clear` the only way a live Droid terminal replaces its session in place?
2. For each such command, which `SessionEnd` (reason, and how the session id relates) and `SessionStart` (`source`, and whether `calling_session_id` or `previous_session_id` is present) fire, in which order, and is the `droid` process the same?
3. Over at least 30 `/new` runs on Droid 0.238.0 and the installed 0.244.0, does the `SessionEnd` `other` for the old session ever arrive at a listener before the new session's `SessionStart`, or before the `SessionEnd` `clear`?

## Short answer

No. `/new` and `/clear` are not the only in-place replacements, and the exit rule did not break on the orders that were measured.

- **`/new` and `/clear` are the same three hooks, on both versions.** `SessionEnd` `reason=clear` for the old session, then `SessionStart` `source=resume` for the new one, then `SessionEnd` `reason=other` for the old one. The new start has neither `calling_session_id` nor `previous_session_id`. The process stays the same.
- **That `other` never won the race.** 30 `/new` and 24 `/clear` on each version, 54 replacements each. Zero times did `other` for the old session arrive before the new `SessionStart`. Zero times did it arrive before the `clear`.
- **`/tree`, and `/resume <id>` on 0.244.0, also replace the session in the same process.** Order: `SessionStart` `source=resume` for the new session (`previous_session_id` names the old one, `calling_session_id` is absent), then `SessionEnd` `reason=other` for the old session. There is no `clear`. The process was still at a prompt afterward.
- **`/fork` does not replace.** The screen says you are still in the original session. No session hook follows the fork.
- **`/sessions` did not replace anything in these runs.** With only empty sessions and a fork, the picker said no session exists until there is a conversation. Choosing a row would have required submitting a prompt, so it was not done.
- **ADR 0007's exit rule is not broken by these arrivals.** On `/new` and `/clear` the `clear` is already in hand before the `other`. On `/tree` and `/resume` the new `SessionStart` (no `calling_session_id`, so ADR 0005 already treats it as the new lead) arrives before the old session's `other`. The process did not exit in either case. The bad order, an `other` for a lead that has not yet been replaced and has no earlier `clear`, was not seen.
- **ADR 0005's lead rule is not broken either.** Every replacement start lacked `calling_session_id`, so the written rule replaces the lead. `/new` and `/clear` also lacked `previous_session_id`, which is what that ADR already says. `/tree` and `/resume` add `previous_session_id`. The rule does not look at that field, so those starts are still new leads, which is the session the user just opened.

One run did submit a prompt. Droid 0.238.0 has no `/resume` slash command. Typing `/resume` plus an id sent that line as a user message. A `UserPromptSubmit` hook fired, the screen showed a turn in progress, and the process was killed before a `Stop` hook. That was not repeated. Every other run in this note has only `SessionStart` and `SessionEnd`.

## Evidence

### Setup

- Droid 0.244.0 is the installed release (`droid --version`). Droid 0.238.0 is the floor, from `https://downloads.factory.ai/factory-cli/releases/0.238.0/darwin/arm64/droid`, checked against the published `.sha256`. The local file's sha256 is `f7e94ff10eda09b0d3140b258899af72aabc136634413e2f62a73a92e40f2afc`. macOS arm64.
- A real key was loaded from a file into the child environment only. `FACTORY_DISABLE_KEYRING=1`, auto-update off, a throwaway `HOME` under `/tmp/droid-34` per run, and every `ORCA_*` variable except `ORCA_PANE_KEY` removed. The real `~/.factory` was not read or copied. The key value is not in this note or the log.
- The first attempt, with a fake key, never reached a prompt. Both versions exited after `Checking authentication...` and the invalid-key line. Those two rows are still in `hooks.jsonl` (`0.244.0/auth`, `0.238.0/auth`). The runs below are the signed-in ones.
- Each signed-in process got Enter at 1.5 seconds, which accepts the folder-trust dialog, then slash commands from 5 seconds, one every 4 seconds. Nothing was typed into the prompt box except those slash commands.
- The listener numbers a hook when the POST body is in hand. Session ids and process identity are stored as `S1` and `P1`, never as the raw values. Relations start over inside each capture.

### `/new` and `/clear`

Each version: four fresh processes that typed `/new`, `/clear`, `/new`, `/clear` six times each (24 `/new` and 24 `/clear`), then six fresh processes that typed one `/new` (6 more `/new`). Every one of those 54 commands produced the same three hooks, and the process id did not change inside the run.

| Order | Hook | Session | source / reason | `calling_session_id` | `previous_session_id` | Process |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `SessionEnd` | old | `clear` | absent | absent | same |
| 2 | `SessionStart` | new | `resume` | absent | absent | same |
| 3 | `SessionEnd` | old | `other` | absent | absent | same |

The hook payload does not say whether the command was `/new` or `/clear`. Both use `reason=clear`. The split is the keys that were typed. The count of triples matched the count of commands, including the six processes whose only command was `/new`.

| Version | `/new` | `/clear` | Fresh processes | `other` before the new `SessionStart` | `other` before `clear` | Process changed mid-run |
| --- | --- | --- | --- | --- | --- | --- |
| 0.238.0 | 30 | 24 | 10 | 0 | 0 | 0 |
| 0.244.0 | 30 | 24 | 10 | 0 | 0 | 0 |

Each process also fires `SessionStart` `source=startup` before the first command, with neither id key, and a final `SessionEnd` `other` for the last session when the process is stopped. That last `other` is the exit, not one of the 54.

### `/tree`, `/resume`, `/sessions`, `/fork`

`/fork` was run first so there was a second session to open. The notice on both versions was the same shape: this session has been forked, you are still in the original session, and a new process can resume the copy with `droid --resume`. No `SessionStart` or `SessionEnd` was added by the fork.

| Command | Version | What the screen did | Hooks, in arrival order | Process |
| --- | --- | --- | --- | --- |
| `/tree`, down, Enter | 0.238.0 and 0.244.0 | Tree showed two sessions in the fork family. Enter on the other row returned to a prompt | `SessionStart` `resume` for the new session, `previous_session_id` = old, `calling_session_id` absent. Then `SessionEnd` `other` for the old session. No `clear` | same |
| `/resume <id>` of the fork | 0.244.0 | Returned to a prompt on the fork | Same two hooks as `/tree` | same |
| `/resume <id>` | 0.238.0 | Not a slash command. The line was submitted as a prompt. The screen said to press Escape to stop, at about 3 seconds | `UserPromptSubmit` for the current session. No `Stop`. Process killed | same, then killed |
| `/sessions` | both | "No sessions found. Start a conversation to create a session." | No hook besides the startup `SessionStart` | same |
| `/fork` | both | Stays on the original session | No session hook | same |

`/sessions` was also opened on 0.244.0 after a `/new` and before any fork. Same empty picker. A row was never selected.

### What the command text said, and where the binary reading was wrong

Names from `droid --help`, the Factory CLI reference at `https://docs.factory.ai/reference/cli-reference`, and the command objects in both binaries. `/compress`, `/handoff`, and `/missions` were not run, because a summary or a mission can spend credits.

| Command | 0.238.0 | 0.244.0 | Measured here |
| --- | --- | --- | --- |
| `/new`, `/clear` | yes | yes | yes, table above |
| `/sessions` | picker only | picker, or an id | picker only, and it was empty |
| `/resume` | no slash command | alias of `/sessions` | id form on 0.244.0 only |
| `/tree` | yes | yes | yes, one selection each |
| `/fork` | yes | yes | yes, does not switch |
| `/compress`, `/handoff`, `/missions` | yes | yes | not run |

`droid --resume`, `droid --last`, `droid --fork`, and `droid exec` start a process. They were not used. The fork notice points at `droid --resume`, which is that new process, not the in-place `/resume`.

The binary's switch function, the one `/tree` and the session picker call, does not itself call `executeSessionEndHooks`. That reading is incomplete. The running terminal still delivered `SessionEnd` `other` for the old session, after the new `SessionStart`. `/new` and `/clear` do call `executeSessionEndHooks` with `clear` before creating the session, and that part matches the log. `/fork` only posts a system notice, which also matches the log.

### ADR 0007 and ADR 0005

ADR 0007 ends the process on `SessionEnd` `other` only when that session is still the lead and no earlier `clear` has replaced it. In the 108 `/new` and `/clear` replacements (54 per version) the `clear` arrived first, then the new start, then the `other`. The process stayed up. In the three successful tree and `/resume` switches there was no `clear`, but the new `SessionStart` arrived before the old session's `other`, and the process was still at a prompt after that `other`. This note cannot see Orca's lead variable. What it can see is that the `other` never arrived before the start that ADR 0005 uses to move the lead.

ADR 0005 says the lead is the latest `SessionStart` that has no `calling_session_id`, from the owner process, and that `/new` and `/clear` fire `source=resume` with neither `calling_session_id` nor `previous_session_id`. The 108 replacements match that sentence, and none of them carried either key. The tree and `/resume` starts also have no `calling_session_id`, so the same rule makes them the new lead. They do carry `previous_session_id` of the session just left. That does not make them children, and it does not keep the old lead. A child start would have named a `calling_session_id`. None of these did.

### Logger self-test

`probe/self-test.py` posted one planted hook through `hook-log.py` and one direct post. Those two rows are first in `hooks.jsonl` (`tag` `self-test`, `seq` 1 then 2). The planted prompt, tool text, message, key, account name, and home path are absent. Ids came out as `S1` and `S2`. The account-named key was dropped. The first row's process is `P1` because a `droid` was already running on this machine and showed up in the parent chain. The raw pid is not in the file.

The replacement captures were tagged `untagged` by the listener: the tag contained a slash, and the listener's token check at that time rejected it. Runs are split by process identity instead. `P1` through `P4` are the four long processes, in the order they were started, and `P5` through `P10` are the six single-`/new` processes. A `capture` field was added when those files were combined. It was not in the hook POST. The switch captures were tagged by the listener after that check was widened, and also carry `capture`.

## Not covered

- Choosing a row in `/sessions`. The picker had nothing to choose until a conversation exists, and a conversation would submit a prompt.
- `/compress`, `/handoff`, and `/missions`.
- `droid --resume`, `droid --fork`, and `droid exec`, which start a new process.
- Whether the lead variable inside Orca moves on the new `SessionStart` or slightly later. Only the hook order was measured.
- Linux, Windows, WSL, and SSH. Only macOS was run.
- A second `/resume` attempt on 0.238.0. The first one submitted a prompt and was killed.

## Fixtures

- `research/droid-session-replacement/hooks.jsonl`: self-test, the two auth rows, the two replacement captures (182 hook rows each), and the switch captures. No raw session id, pid, prompt, or key.
- `research/droid-session-replacement/probe/`: `listener.py`, `hook-log.py`, `make-home.sh`, `env_child.py` (reads `KEY_FILE` when set, otherwise a fake key, and never prints it), `pty_drive.py`, `run-new.sh` (one signed-in process, Enter at 1.5 seconds, then `/new` or `/new` plus `/clear`), `render.py`, `render_screen.py`, `self-test.py`, `scrub.py`. `scrub.py` also reads `KEY_FILE` and prints `clean` or a hit count, never the value. The scripts expect `/tmp/droid-34` unless `PROBE_ROOT` is set, and the 0.238.0 binary at `/tmp/droid-31/bin/0.238.0/droid` unless `DROID_238` is set.
- Screen captures stayed in `/tmp` and are not in this commit. They were checked for the key, an email address, and a home path before the log was copied.
