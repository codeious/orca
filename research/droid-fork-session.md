# What `droid.fork_session` does to the process, and what `exec --fork` does without a prompt

Ticket: [Does `droid.fork_session` leave the process on the fork, and does `droid exec --fork` work over `stream-jsonrpc` without a prompt?](https://github.com/codeious/orca/issues/47)
Branch: `research/droid-fork-session` (never merged, no PR).

## Question

ADR 0007 (`docs/adr/0007-orca-keeps-one-writer-per-droid-session-among-the-writers-it-can-see.md`, not yet on `main`) defers a "Fork into new chat" action because two things were never tried: where the process stands after `droid.fork_session`, and whether `droid exec --fork` runs over `stream-jsonrpc` without a prompt. The answer decides whether a fork can serve the two deferred cases, a session a terminal pane holds and a session recorded in a folder other than the workspace.

## Short answer

- **After `droid.fork_session` the process is still on the original session.** Renames and messages sent afterwards land in the original file, and notifications still carry the original id. The process moves to the fork only after an explicit `droid.load_session` of the new id. Same on 0.249.0 and 0.238.0, with a made-up key and a signed-in key.
- **The fork is a separate file, copied, not referenced.** The call returns only `{ newSessionId }`. The new file holds every record of the original (same message ids), and its first line adds `parent` (the original id) and `forkedAtMessageId` (the original's last user-typed message). The original file's bytes do not change. Writes made after the fork to either file did not show in the other.
- **`droid exec --fork` does not work over `stream-jsonrpc`, with or without a prompt.** Both versions refuse at start: `Invalid flags: --fork is not supported with --input-format stream-jsonrpc, --output-format acp, or --output-format acp-daemon.` Exit 1 within 3 s, no session file, no frame on stdout.
- **`droid exec --fork <id>` with no prompt does nothing useful.** In the default text mode it waits on stdin, and when stdin closes empty it exits 1 with `No prompt received on stdin (the input was empty). Pass a prompt argument, use -f <file>, or pipe non-empty text.` It writes no fork file.
- **A fork keeps the original's recorded folder unless `exec --fork` is given `--cwd` and a prompt.** `droid.fork_session` from a process started in another folder records the original folder. Only `exec --fork <id> --cwd <dir> "<prompt>"` records `<dir>` in the new file at once, and that needs a prompt.
- **Terminal-held case: a fork can serve it with no prompt.** With a live terminal on the session, `load_session` then `fork_session` from another process left the original's bytes unchanged and the terminal still named the original when it exited. `droid --fork <id>` as a terminal UI also needs no prompt.
- **Recorded folder differs from workspace: a fork serves it in two steps, no prompt.** The fork is recorded in the original's folder. Then `droid.change_working_directory` on the loaded fork moves it to a folder the host trusts (an untrusted folder is refused with `-32600`). The original keeps its folder. The fork's `session_start.cwd` still names the old folder and a new `lastCwd` key names the new one. The same call is what the earlier folder note found moves a session's commands.

## Scope and method

- macOS arm64, `droid` 0.249.0 (newest at the time) and 0.238.0, each downloaded to a scratch directory. The user's installed `droid` was never run.
- A throwaway `HOME` per run with `FACTORY_DISABLE_KEYRING=1`, auto-update off, every `ORCA_*` variable removed, and two real folders: `a` (where the original is recorded) and `b`.
- Two key modes. **Made-up key:** a string that cannot authenticate, so any prompt ends in a recorded `model_authentication_failed` turn and costs nothing. **Signed-in key:** the key from the user's key file, held in memory by the probe and placed only in the child process environment. It was used only where no prompt is sent. Every original session was seeded with the made-up key.
- The signed-in key sent no prompt: the only `droid.add_user_message` frames are the seed turns, and no session file holds a model reply. The key value does not appear in any output file or any run directory (searched by value).
- Driver: a JSON-RPC client over `exec --input-format stream-jsonrpc --output-format stream-jsonrpc`, as Orca's structured sessions use. For the terminal cases, a PTY driver that types only the folder-trust Enter and Ctrl-C.
- Which session the process holds is read from where a free write lands (`droid.rename_session` always, a failed-auth `droid.add_user_message` with the made-up key) and from the `sessionId` on each `droid.session_notification`. Files are compared by SHA-256 and by a one-line shape per record.
- Ids and paths are replaced by labels (`S` original, `F` fork, `<root>/a`). Raw transcripts stay out of git: their first message embeds the environment reminder text. The shape lines in `results/` are the evidence.

## Findings

### 1. The process stays on the original

`s1`: seed S with one failed turn, then in one process: `load_session(S)`, `fork_session`, `rename_session`, `add_user_message`, `load_session(F)`, `rename_session`, `add_user_message`.

| Step | Files that changed | `sessionId` on notifications |
| --- | --- | --- |
| `fork_session` | F created (5 records). S unchanged. | none sent |
| `rename_session` after the fork | S only | `session_title_updated:S` |
| `add_user_message` after the fork | S only (5 to 8 records) | `droid_working_state_changed`, `create_message`, `error`, `agent_turn_completed`, all `:S` |
| `load_session(F)` | none | `settings_updated`, with no session id |
| `rename_session` after the load | F only | `session_title_updated:F` |
| `add_user_message` after the load | F only (5 to 8 records) | all `:F` |

The same rows came out for both versions, in both key modes (the signed-in key did the renames only). The 0.249.0 and 0.238.0 binaries both call their fork routine with `preserveCurrentSession: true`, which matches the measurement.

`load_session` on 0.249.0 returns `session.messages` and `session.title` and no id, so the id cannot be read from the load result. Read it from the notifications.

`fork_session` with nothing loaded fails with `-32603 No active session. Call initialize_session or load_session first.` (both versions).

### 2. What the fork is

- Its own file, in the same folder directory as the original when the folder is the same, with a new session id.
- `session_start` has the original's fields plus `parent: S` and `forkedAtMessageId`. The id points at the last message the user typed (message 1 in a one-turn session, message 3 in a two-turn session), not the last record. Everything after it is copied too: the failed-turn error message and the `agent_turn_outcome` record.
- Message ids are copied unchanged. A message added later on the fork gets a fresh id whose `parentId` is the last copied message.
- Independent after the call: when the post-fork writes took S from 5 to 8 records and a new title, F stayed at 5 records with the old title. The writes made after `load_session(F)` then grew F alone.
- `fork_session` takes `title` (stored as the title, with `isSessionTitleManuallySet: true`) and `tags` (an array of objects; strings are rejected with `-32602`). Without a title the fork keeps the original's. The tags did not appear in `session_start`; where they go was not looked for.
- With the signed-in key the fork had one extra record at the end of its copy, a `user_only` notice that the session's model is legacy and was replaced. The made-up key produced none. A reader of fork files should tolerate extra trailing records.

### 3. `exec --fork` over `stream-jsonrpc`

`s2`: five variants (process in `a` or `b`, `--cwd` absent, equal to `b`, or a missing folder), both versions, both key modes. Nothing is sent on stdin.

- Four variants exit 1 in 0.7 to 3.0 s with the `Invalid flags` line above. No fork file, the original unchanged.
- The missing-folder variant differs by version: 0.249.0 checks the folder first and exits in under 50 ms with `Error changing to directory … ENOENT`. 0.238.0 prints the `Invalid flags` line.
- `--fork` is refused with `--output-format stream-jsonrpc` alone too (`Use --output-format stream-json, or drive the session with --input-format stream-jsonrpc`), and `--input-format stream-jsonrpc` alone is refused for needing the matching output format. The only structured one-shot form that accepts `--fork` is `--output-format stream-json` with a prompt.

### 4. `exec --fork <id>` with no prompt

`s4`, both versions, made-up key. With stdin held open for 8 s: still alive, 0 bytes out, no file. With stdin closed empty (or closed at the start, as a spawn with stdin ignored does): exit 1 with the `No prompt received on stdin` line, no file, original unchanged. Same with `--cwd b`.

Whatever arrives on stdin becomes the prompt. An earlier version of the probe closed a JSON-RPC session by writing a request to stdin, and the fork ran that text as a model turn. That is why the probe never writes to stdin in this case, and why the text-mode no-prompt run used the made-up key only. With the signed-in key, `exec --fork` ran only in the `stream-jsonrpc` form, which exits at flag validation before any model call.

### 5. Which folder the fork records

`s3`, both versions. S is recorded in `a`.

| Command | Fork records |
| --- | --- |
| `fork_session` from a process started in `b` | `a`, same folder directory as S |
| a new process in `b` then loads that fork | reports `a` |
| `exec --fork S "<prompt>"` from `b`, no `--cwd` | `a` |
| `exec --fork S --cwd a "<prompt>"` | `a` |
| `exec --fork S --cwd b "<prompt>"` from `a` | `b`, in a different folder directory |
| `exec --fork S --output-format stream-json "<prompt>"` | `a` |

The last four ran with the made-up key: the prompt ran on the fork and failed authentication, adding four records after the copy (checked on every row, both versions). The original never changed.

### 6. A session a terminal holds

`s5`, both versions, signed-in key for the terminal only, nothing typed.

- T1: `droid --resume S` in a PTY reached the prompt box with S's history on screen. At 24 s after launch, a second process ran `load_session(S)` and `fork_session`. Result: no error, F created with `parent: S` and 5 records, S byte-identical before and after (the load included), and byte-identical at the end of the run. The terminal's exit line, printed after the fork, still named S.
- T2: `droid --fork S` as a terminal UI, started from folder `b`, reached the prompt box with no prompt. It created a fork recorded in `a` ("Restored to original working directory …/a" is printed) and its exit line names the fork, so the terminal is on the fork. S unchanged.

### 7. Moving a loaded fork to another folder

`s7`, both versions. S is recorded in `a`; `b` is the workspace. No prompt is sent. The signed-in key started a terminal in `b` once, to accept the folder-trust dialog, and nothing was typed.

| Step | Result |
| --- | --- |
| `fork_session`, `load_session(F)`, then `change_working_directory` to `b` while `b` is not trusted | refused: `-32600` "Folder is not trusted: …. Open it in the Droid CLI and accept the trust prompt, then try again." |
| The same call after `b` is trusted, on a fresh process that loaded F | succeeds, returns `resolvedPath` `b` |
| The fork's transcript | no new record. Line 1 (`session_start`) gains one key, `lastCwd` (`b`). `cwd` stays `a` and the file stays under `a`'s folder directory. |
| The original's transcript | byte-identical |
| Session index (`cache/session-index/index.db`, `sessions.cwd`) | F: `b`. S: `a`. |
| A new process loads F, then S | F reports `b`. S reports `a`. |

So the fork can have its own working folder, set after the copy, and the original is not affected. The earlier folder note put the new folder in the session index and found the session file unchanged. Here the file's first line also changes, so a reader that takes a session's folder from `session_start.cwd` still sees the old folder, and the Orca vault parser is one such reader.

No command was run in the new folder in this study. The earlier folder note did that, on 0.243.0, with one paid turn.

### 8. Differences between the versions

None in the process behaviour, the fork contents, the folder rule, the folder change, or the terminal cases. The only difference is the order of two checks in `exec --fork` for a missing `--cwd` folder (section 3). This also puts `change_working_directory` on the 0.238.0 floor, which the earlier folder note had not tried.

## What this means for the two deferred cases (not decided here)

| Case | Can a fork serve it with no prompt? | Route that worked |
| --- | --- | --- |
| A terminal pane holds the session | Yes, at no cost | `load_session(S)`, `fork_session`, then `load_session(F)`. S is read, never written. Or the terminal's own `droid --fork`. |
| The recorded folder is not the workspace | Yes, at no cost | The same sequence, then `change_working_directory` to the workspace on F. The workspace must be trusted on the host. Without that call the fork works in the recorded folder. Only `exec --fork --cwd <dir> "<prompt>"` records another folder in the new file at once, and that sends a prompt. |

The sequence that leaves one writer per file: the forking process must not send a write between `fork_session` and `load_session(F)`, because until then it still holds S. A new process that loads F gives the same result without that window.

## Limits

- The fork was taken while the original was idle. A fork taken while another process appends to the original was not tried.
- A terminal that has a prompt typed or a turn running was not tried. The terminal held S idle.
- `exec --fork` without a prompt using the signed-in key was not run, because stdin content would become a paid prompt. The made-up key shows it never gets past waiting for stdin.
- `-f <file>` as a prompt source for `exec --fork` was not run.
- `change_working_directory` while the agent is working was not tried (the earlier note read a refusal from the binary). Trust was accepted by a terminal start on a throwaway `HOME`; the user's real `trustedFolders` and an SSH or WSL host were not tried. `change_working_directory`, the session index and `trustedFolders` are not published contracts.
- Where `tags` end up, and whether a fork copies settings (model, autonomy) beyond the `session_start` fields, were not looked at.
- One platform (macOS arm64) and two versions. A remote host or Windows may differ in path handling.
- How a deleted original affects a fork was not tried. The fork file holds the whole history, so it should not depend on S, but that is inferred from the file contents.

## Files

- `research/droid-fork-session/probes/lib.mjs`: sandbox, JSON-RPC driver, masker, key handling.
- `s1-fork-in-process.mjs`: section 1 and 2. `s2-exec-fork.mjs`: section 3. `s3-fork-folder.mjs`: section 5. `s4-exec-fork-no-prompt.mjs`: section 4. `s5-terminal-held.mjs`: section 6 (needs a PTY driver, set with `PTY_DRIVE`; the `pty_drive.py` from `research/droid-session-sharing` was used). `s6-fork-session-params.mjs`: no-session call, `title`, `tags`. `s7-fork-change-folder.mjs`: section 7 (needs `sqlite3` and the same PTY driver).
- `research/droid-fork-session/results/`: masked results, one file per probe, version and key mode. They contain record shapes, not transcripts.
