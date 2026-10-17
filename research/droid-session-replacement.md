# What do SessionEnd and SessionStart fire when a Droid terminal replaces its session in place?

## Question

[How does Orca's Droid listener read SessionEnd and late or missing session hooks?](https://github.com/codeious/orca/issues/33) decided that a Droid `SessionEnd` ends a terminal's process only when all of these hold: it carries the identity of the row's owner process, its `session_id` is the pane's current lead, its `reason` is `other`, and an earlier `reason=clear` has not already replaced that lead. `clear` (from `/new` and `/clear`) only marks the lead replaced. A row marked ended drops every later hook from that process, so a wrong exit blanks a live pane. ADR 0007, "Orca keeps one writer per Droid session among the writers it can see", records that rule.

The rule rests on two things seen in few runs. This note checks them.

1. Is `/new` or `/clear` the only way a live Droid terminal replaces its session in place?
2. For each such command, which `SessionEnd` (reason, and how the session id relates) and `SessionStart` (`source`, and whether `calling_session_id` or `previous_session_id` is present) fire, in which order, and is the `droid` process the same?
3. Over at least 30 `/new` runs on Droid 0.238.0 and the installed 0.244.0, does the `SessionEnd` `other` for the old session ever arrive at a listener before the new session's `SessionStart`, or before the `SessionEnd` `clear`?

## Short answer

Partial. The terminal runs were stopped.

- **Both 0.238.0 and 0.244.0 exited during startup** when `FACTORY_API_KEY` was an obviously fake placeholder. After the splash, the scrubbed screen was `Checking authentication...` and then `Authentication failed. FACTORY_API_KEY is set but appears to be invalid. Unset it or replace it with a valid key.` There was no prompt. No slash command was accepted. No Droid hook reached the listener.
- **Questions 2 and 3 were not answered.** There is no arrival count. Nothing here shows that the exit rule breaks, and nothing here shows that it holds.
- **Question 1, the names only, is answered from `droid --help`, the Factory docs, and strings in both binaries.** The TUI's own slash list was not on screen. `/new` and `/clear` are not the only commands whose text says a live terminal can leave its current session. `/sessions` (and, on 0.244.0 only, `/resume`) is a picker. `/tree` resumes a branch. `/compress` and `/handoff` say they start a new session from a summary. `/fork` copies a session and, per the docs, leaves you in the original. None of that was watched in a running terminal.

## Evidence

### Setup

- Droid 0.244.0 is the installed release (`droid --version`). Droid 0.238.0 is the floor, from `https://downloads.factory.ai/factory-cli/releases/0.238.0/darwin/arm64/droid`, checked against the published `.sha256`. The local file's sha256 is `f7e94ff10eda09b0d3140b258899af72aabc136634413e2f62a73a92e40f2afc`, the same value the published file prints. macOS arm64.
- One throwaway `HOME` per smoke, under `/tmp/droid-34`. The real `~/.factory` was not read or copied. `FACTORY_DISABLE_KEYRING=1`, `FACTORY_DROID_AUTO_UPDATE_ENABLED=false`, and every `ORCA_*` variable except `ORCA_PANE_KEY` removed from the child. The fake key was set only in that child.
- Two smokes, one per version. Each was a new `droid` with no arguments, in a terminal the script opened. No prompt was typed as a message. The 0.244.0 smoke had an Enter and a `/` queued, but the process closed that terminal on its own at the auth line, and the capture does not show those keys. The 0.238.0 smoke sent nothing. Both were killed only if still alive after the capture, and only those two processes.
- The listener and logger were self-tested with planted prompt, tool, message, key, account, and home strings. The written log does not contain them. No Droid process was part of that test.
- Docs: the slash-command table and the `--resume` / `--fork` flags on `https://docs.factory.ai/reference/cli-reference`, fetched for this note. `droid --help` and `droid resume --help` on 0.244.0, and `droid --help` on 0.238.0.

### What the screen showed

| Version | Run | Process | Screen after the splash | Prompt where `/` works |
| --- | --- | --- | --- | --- |
| 0.244.0 | `0.244.0/auth` | exited on its own | `Checking authentication...` then the invalid-key line quoted above | no |
| 0.238.0 | `0.238.0/auth` | exited on its own | the same two lines | no |

### Commands named without a running terminal

These are names, not measured hooks. "In the binary" means the command object inside that version's `droid` file.

| Command | 0.238.0 binary | 0.244.0 binary | Docs page | What the text says about the current session |
| --- | --- | --- | --- | --- |
| `/new` | yes | yes | yes | Start a fresh session, reset model and autonomy |
| `/clear` | yes | yes | yes | Clear context, keep model and autonomy. Not the same sentence as `/new` |
| `/sessions` | yes. "List and select previous sessions to resume" | yes. "List previous sessions to resume, or resume one by id" | yes. "List and select previous sessions" | A picker, or (0.244.0 only) an id on the same command |
| `/resume` | no slash command with this name | yes. Alias of `/sessions` | not in the slash table. The CLI flag `--resume` is a different thing | Same picker as `/sessions` on 0.244.0 |
| `/tree` | yes | yes | yes | Browse and resume branches in the fork tree |
| `/fork` | yes | yes | yes | Copy into a new session. The docs say you stay in the original and get a `droid --resume <id>` line for the copy |
| `/compress` | yes | yes | yes | Docs: compress and move to a new session with a summary. The binary also has "in place" and "This will start a new session with the resulting summary." A summary is a model call, so it was not run |
| `/handoff` | yes | yes | not in the slash table | "Start a new session with a summary of this conversation." Not run, same reason |
| `/missions` | yes | yes | not as a session switch | "Enter, manage and resume missions." A mission was not started |
| `/rewind-conversation` | yes | yes | not in the fetched table | Rewind to an earlier point. The wording does not say a new session |
| `/logout` | yes | yes | yes | Sign out. Not a new session |
| `/quit`, `/exit` | yes. `/exit` is an alias of `/quit` | same | yes | Leave the process |

`/compact` appears only as the words "alias: compact" on the compress description. Neither binary has a command whose name is `compact`.

Help on both versions, which starts a process rather than switching one that is already up:

| Invocation | Both helps say |
| --- | --- |
| `droid --resume [sessionId]`, alias `-r` | Resume by id or session link. With no id, show a session picker |
| `droid --resume --last` | Skip the picker and resume the most recent session in the current folder |
| `droid resume [sessionId]` | Same picker when the id is omitted |
| `droid --fork <sessionId>` | Fork and resume a session |
| `droid exec -s <id>` and `droid exec --fork <id>` | Non-interactive. Not a terminal session switch |

The startup picker is the first session of a new process. It is not a live terminal leaving a session it already has.

### Read from the binaries, not from a running terminal

This is the command code, not a hook log. It is the same shape in both files where the command exists. It does not answer question 2.

- `/new` and `/clear` call one function. That function awaits `executeSessionEndHooks` with `reason` `clear`, then calls `createSession`. `/clear` passes a flag to keep the session settings. `createSession` then calls `executeSessionStartHooks` with a source, a parent id, and a calling id. The values of those three are not copied here.
- `/sessions` with no id opens the selector. On 0.238.0 that is the whole command. On 0.244.0 an id calls `resumeSession`.
- `/tree`, when the choice is "resume", calls the same switch function the selector uses. That function does not itself call `executeSessionEndHooks`. It does call a scheduled-task leave helper named `session-leave`, then loads the chosen session.
- `/fork` calls `forkSession` and posts a message that includes the new id. That function does not call the switch.
- `/logout` calls `executeSessionEndHooks` with `reason` `logout`, then signs out. `/quit` calls it with `reason` `other`, then exits.
- Other `executeSessionEndHooks` sites in 0.244.0 are process exit, a deployment switch (`reason` `other`), and structured-session close (`reason` `other`, or a reason passed in). None of those is the in-terminal picker.

`previous_session_id` is a field on the `SessionStart` hook object in both binaries. Whether a given command sets it was not measured.

### Arrival order

Not measured. The listener never received a Droid hook.

| Version | `/new` runs | Fresh processes | `SessionEnd other` before the new `SessionStart` | `SessionEnd other` before `SessionEnd clear` |
| --- | --- | --- | --- | --- |
| 0.238.0 | 0 | 1 auth smoke, no `/new` | not observed | not observed |
| 0.244.0 | 0 | 1 auth smoke, no `/new` | not observed | not observed |

The exit rule in ADR 0007 was not exercised. No shape was seen that breaks it.

### Logger self-test

`probe/self-test.py` posted one planted hook through `hook-log.py` and one direct post. `hooks.jsonl` has those two listener rows (`tag` `self-test`, `seq` 1 then 2, arrival time not reversed) plus the two auth rows. The planted prompt, tool text, message, key, account name, and home path are absent. Ids came out as `S1` and `S2`. The account-named key was dropped. `source` and `reason` were kept. The first row's process is `P1`, because the logger's parent chain included a `droid` process already running on this machine. The raw pid is not in the file.

## Not covered

- Every hook question that needs a live prompt: order, session-id relations, `calling_session_id`, `previous_session_id`, and whether the `droid` process stays the same. That includes `/new`, `/clear`, `/sessions`, `/resume`, `/tree`, `/fork`, and the late `SessionEnd other`.
- The 30-run arrival check on both versions.
- `/compress`, `/handoff`, and `/missions`, which were not run because a summary or a mission can spend credits.
- Linux, Windows, WSL, and SSH. Only the macOS binaries were read, and only macOS was started.
- A real sign-in. No key, keychain, or `~/.factory` file was read.

## Fixtures

- `research/droid-session-replacement/hooks.jsonl`: the self-test rows and the two auth rows. No `/new` row, because none was produced.
- `research/droid-session-replacement/probe/`: `listener.py` (binds `127.0.0.1` on a free port and numbers arrivals), `hook-log.py`, `make-home.sh`, `env_child.py`, `pty_drive.py`, `run-new.sh`, `render.py`, `render_screen.py`, `self-test.py`, `scrub.py`. `run-new.sh` is the `/new` driver and was not run. `render.py hooks.jsonl <tag-prefix>` prints arrival order. The scripts expect `/tmp/droid-34` unless `PROBE_ROOT` is set, and the 0.238.0 binary at `/tmp/droid-31/bin/0.238.0/droid` unless `DROID_238` is set.
- No key, home path, or account name is in any of these files.
