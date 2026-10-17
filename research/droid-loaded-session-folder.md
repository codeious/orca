# Which folder do a loaded Droid session's tools run in?

## Question

[Does a structured Droid session share its session id and transcript with a terminal Droid session?](https://github.com/codeious/orca/issues/23) found that `droid.load_session` finds a session by id from any folder and reports the folder it was recorded in, but ran no tool. This note answers what it left open: when a process started in one folder loads a session recorded in another, which folder do the session's shell commands run in, can anything set that folder, and what do `droid --resume` and `droid --fork` do?

## Short answer

**In the folder the session was recorded in, never the folder the loading process was started in.** Three paid turns on Droid 0.243.0 agree: a structured `droid.load_session`, a terminal `droid --resume <id>`, and a terminal `droid --fork <id>`, all started in folder B on a session recorded in folder A, ran `pwd` in A. A fourth paid turn tested the folder change below. Nothing asked the user and nothing failed, so a chat that shows workspace B while Droid works in A looks healthy.

One call changes it: `droid.change_working_directory` on a loaded session. After it the next command ran in the new folder. It needs the new folder trusted on that host and an idle agent. The change is stored in Droid's session index, not in the transcript, so the session file and the vault still show the old folder.

| Started in B, session recorded in A | Folder the shell command ran in | How known |
| --- | --- | --- |
| Structured: `droid.load_session`, then a prompt | **A** | paid turn, tool result and hooks |
| Terminal: `droid --resume <id>` | **A** | paid turn, tool result and hooks |
| Terminal: `droid --fork <id>` | **A** (fork file written under A) | paid turn, tool result and hooks |
| Structured: `droid.load_session`, `droid.change_working_directory` to trusted C, then a prompt | **C** | paid turn, tool result and hooks |
| Structured: `droid.load_session` when A no longer exists | **B** (hook folder; no command run) | free, hooks only |
| `droid exec -s <id>` / `droid exec --fork <id>` | session stays in A; `--fork --cwd C` is written under C | free, file placement only; no command run |

What this means for the spec, as inputs for the decision and not the decision:

- **Resume in new chat for Droid has no guard today and needs one.** Orca applies the "target workspace must match the session's folder" rule to Claude only. For Droid the gap is quieter than for Claude: Claude fails to find the transcript, while Droid finds it and works in the wrong folder. The options are to require a match, or to call `droid.change_working_directory` before the first turn, or to refuse. The change call fails on an untrusted folder, and the `droid.*` methods in this build include none that trusts a folder.
- **A resuming adapter must use `droid.load_session` and never `droid.initialize_session` with a `sessionId`.** The second creates a second, nearly empty session file with the same id under the new folder and does not load the history.
- **A hook's `cwd` is not the session folder everywhere.** `SessionStart` reports the loading process's folder for a structured load and for `droid exec`, and the session folder in the terminal. `UserPromptSubmit` and `PreToolUse` report the folder commands run in.

## Findings

### Setup

- Droid CLI 0.243.0, `factoryProtocolVersion` `1.269.0` in responses. macOS.
- Throwaway `HOME` and three project folders under `/tmp/droid-28`: `proj-a` (where the session is recorded), `proj-b` (where the loading process starts), `proj-c` (target of the folder change). `FACTORY_DISABLE_KEYRING=1`, `FACTORY_DROID_AUTO_UPDATE_ENABLED=false`. `ORCA_*`, `FACTORY_SESSION_ID`, and `FACTORY_UPSTREAM_CLIENT_TYPE` were removed from every child environment. No Mission was started.
- A hook logger in the throwaway `HOME` (`probes/hook-log.mjs`, config in `probes/throwaway-home-hooks.json`) records only the event name, the payload `cwd`, and the hook process's own working folder. In all four paid turns the `PreToolUse` payload folder equalled the folder the command printed.
- Free runs used an **invalid** `FACTORY_API_KEY`, so a prompt fails before any model call. They show file placement and hooks, but no command runs.
- Paid runs read a key from a user-supplied file into the child environment only (`probes/with-key.sh`, `probes/paid-lib.mjs`). Four turns were sent with the user's approval, each with the same prompt: "Run the shell command pwd using the shell tool and reply with only its output. Do not use any other tool." Model `gpt-6-luna`, reasoning effort `none`, autonomy `low`. Before the paid turns, the TUI was started once in each folder to accept the trust dialog and exited with no prompt, which costs nothing. Cost: the two session sidecars show 1,042 and 587 `factoryCredits`; the fork's figure may include history copied from its source, so the four turns cost at most about 1,630 credits.

### 1. A loaded structured session keeps its recorded folder

- A session was recorded in A by `droid.initialize_session` with `cwd` A. A second process, started in B, called `droid.load_session` on it. The result reports A (`result.cwd`).
- The prompt ran `pwd` in **A**. The tool result and the assistant's reply were `proj-a`, and the `PreToolUse` and `PostToolUse` hooks reported A.
- The `SessionStart` hook on that load reported **B** (payload folder and hook process folder). `UserPromptSubmit`, `PreToolUse`, and `PostToolUse` reported A. So a listener that reads the folder from `SessionStart` of a loaded structured session gets the wrong folder.

### 2. Terminal `droid --resume` and `droid --fork` from another folder

- `droid --resume <id>` started in B went straight to the prompt box with no dialog. All four hook events reported A, including `SessionStart` and the hook process folder, and `pwd` printed A. The TUI itself works from the recorded folder.
- `droid --fork <id>` started in B behaved the same. The fork was written under A's folder slug with `session_start.cwd` A and `parent` set to the source, and `pwd` printed A. The fork copied the source's history, including its earlier `pwd` turns, so its file shows three tool calls, one of them new.

### 3. What can and cannot set the folder of a loaded session

- **`droid.load_session`**: no folder param. A `cwd` sent to it is accepted and ignored (as the earlier note found; the params schema read from the binary has no such field).
- **`droid.initialize_session`**: `cwd` is required and a client-chosen `sessionId` is optional. With the id of an existing session and `cwd` B it returned the same id and wrote a **second file with that id** under B's folder slug: two records, title `New Session`, no history. The original file stayed under A. A later `droid.load_session` of that id from A returned the A file (7 messages), and from B and from C returned the B file (1 and 2 messages). So `initialize_session` is not a resume, and a duplicated id makes the loaded session depend on the caller's folder.
- **`droid.update_session_settings`**: no folder field in its params schema. A `{cwd: C}` call returned no error and changed nothing on disk. No command was run after it.
- **`droid.change_working_directory {workingDirectory}`** returns `{resolvedPath}` and is the only way found. Seen: after the call, the next `pwd` printed C and the `UserPromptSubmit` and `PreToolUse` hooks reported C. It wrote **no transcript record**. The session file keeps `session_start.cwd` A and its A folder slug, and the session sidecar has no folder field. The new folder is stored in the `cwd` column of the `sessions` table in `~/.factory/cache/session-index/index.db` (row for the session: `project_key` still A's slug, `cwd` C). A fresh process started in B that loaded the session afterwards reported C. Whether `load_session` reads that column is inferred, not shown.
- Conditions on `change_working_directory`: a folder that is not trusted on that host is refused with `-32600` "Folder is not trusted: <path>. Open it in the Droid CLI and accept the trust prompt, then try again." Trust is a `trustedFolders` map (keyed by realpath) in the user's `~/.factory/settings.json`, the same file Orca's hook installer edits today. The binary also refuses a change while the agent is working (text read from the binary; not run).
- The `droid.initialize_session` call that creates a session in an untrusted folder succeeded, so trust gated only the folder change in these runs.

### 4. `droid exec -s`, `--fork`, and `--cwd` (free, no command run)

- `droid exec -s <id>` from B, with and without `--cwd C`, wrote into the existing file under A (2 records to 12 across both runs); `--cwd` did not move the session.
- `droid exec --fork <id>` from B wrote the fork under A's slug with `session_start.cwd` A. With `--cwd C` it wrote the fork under C's slug with `session_start.cwd` C. So `--cwd` sets the folder of a new fork, while `-s` keeps the recorded one.
- `droid.fork_session` (params: `title`, `tags`; it forks the session the process holds) from a process in B that loaded the session wrote the fork under A.
- `SessionStart` reported the process folder (B), or C with `--cwd C`.
- Whether commands run in C for `-s --cwd C` was not tried.

### 5. The recorded folder no longer exists (free)

- A session recorded in a folder that was then deleted still loads. `droid.load_session` reported the loading process's folder (B), and the `UserPromptSubmit` hook ran in B. No command was run, but in the four paid turns the hook folder matched the command's folder every time. Droid silently falls back to the loader's folder.
- That run also left the session's sidecar under a second slug (`-tmp-...` without the realpath prefix) beside the realpath slug, so a session's files can split across two folder slugs when the folder is missing.

## Orca code read (what the spec changes)

- `src/renderer/src/components/right-sidebar/ai-vault-session-resume-in-chat.ts`: `aiVaultSessionResumeInChatWorkspaceMatters` (line 36) is true for `claude` only, and the eligibility check (lines 95 to 98) refuses a workspace mismatch only then. The comment (lines 29 to 33) says Codex is handed a cwd and Claude derives its project key from the launch folder. Droid has no way to be handed a folder at load, and it does not fail on a mismatch, so it needs its own rule once it is eligible at all.
- `src/main/ai-vault/session-scanner-droid-parser.ts` (lines 78 and 82): the vault takes a Droid session's folder from `session_start.cwd`. After `droid.change_working_directory` that value is stale; Droid's index holds the current folder.

## Not tested

- Tools in `droid exec -s <id> --cwd C`, and `droid --resume <id> --cwd C`.
- A terminal `droid --resume <id>` after a `droid.change_working_directory`: which folder the TUI works in.
- Commands run after a deleted recorded folder (hooks only).
- A folder change while the agent is working (refusal read from the binary, not run).
- The `sessionLocation` param of `droid.load_session`.
- Git worktree sessions (`droid -w`), Windows, WSL, and SSH hosts, including folder slugs for those paths.
- Droid versions other than 0.243.0, including the 0.238.0 floor.
- Several loads in a row, and a load during another process's live turn.

## Fixtures

`research/droid-loaded-session-folder/fixtures/`:

- `tool-evidence.txt`: for the loaded session and the terminal fork, each record's `session_start` folder, tool call, tool result, and outcome, in file order. Folders are relative to the throwaway root.
- `hook-events-load-from-other-folder.jsonl`: free run: a session recorded in A, loaded from B, and an attempted change to an untrusted C.
- `hook-events-tui-resume.jsonl`, `hook-events-tui-fork.jsonl`: the paid terminal turns.
- `hook-events-exec-fork-cwd.jsonl`: the free `droid exec` and `droid.fork_session` runs.
- `hook-events-change-directory-and-missing-folder.jsonl`: the paid folder change and its fresh reload, then the free deleted-folder run.

The hook log for the paid structured load (turn 1) was not saved to a file. Its four events were read from the run's console output: `SessionStart` B, then `UserPromptSubmit`, `PreToolUse`, and `PostToolUse` all A. The same `SessionStart` B then A pattern is in the saved free run. The raw JSON-RPC frames and the TUI captures were not kept.

`research/droid-loaded-session-folder/probes/` holds the scripts: `lib.mjs` and `paid-lib.mjs` (spawn Droid, speak JSON-RPC, read the key from `KEY_FILE`), `c1`, `c2`, `c3` (free), `p1`, `p4` (paid structured turns), `tui-recon.sh`, `tui-paid.sh`, `trust-folders.sh`, `tui-evidence.mjs`, `tool-evidence.mjs`, and the pty helpers copied from the earlier note's branch. They assume the scratch root `/tmp/droid-28`.

## Evidence log

- `droid --version` is 0.243.0; `factoryProtocolVersion` `1.269.0` in responses.
- Free: record in A and load from B; attempted change to an untrusted C; `initialize_session` with an existing `sessionId`; `update_session_settings {cwd}`; `droid exec -s` and `--fork`, with and without `--cwd`; `droid.fork_session`; load of a duplicated id from three folders; load after the recorded folder was deleted; the `sessions` row in the session index.
- Zero cost: TUI in A, B, and C to accept trust; TUI `--resume` and `--fork` of the session from B to the prompt box.
- Paid, one prompt each: structured load from B; TUI `--resume` from B; TUI `--fork` from B; structured load from B with `droid.change_working_directory` to C.
- Orca: the two files named in "Orca code read".

## Unknowns and risks

- `droid.change_working_directory`, the session index, and the `trustedFolders` map are not published contracts. The spec should treat them as version-gated, and the floor (0.238.0) was not tried.
- The fallback to the loader's folder when the recorded folder is gone is seen through hooks only.
- One model and one prompt, on macOS. A model that runs commands through another tool might not follow the same folder, though hooks and results matched in all four paid turns.

## Confidence

| Finding | Confidence |
| --- | --- |
| Structured load, TUI `--resume`, and TUI `--fork` from another folder run commands in the recorded folder | high (three paid turns, tool results and hooks agree) |
| `droid.change_working_directory` moves the next command to the new folder | high (one paid turn); that it needs a trusted folder is high (error seen) |
| The new folder is kept in the session index and not the transcript | medium (one run; `load_session` reading it is inferred) |
| `initialize_session` with an existing `sessionId` creates a second file with that id | high (one run, file listing) |
| `update_session_settings` and `load_session` cannot set the folder | high for `load_session`; medium for `update_session_settings` (no command run after the call, schema read from the binary) |
| Fork placement for `droid exec --fork` and `droid.fork_session` | medium (one run each) |
| A deleted recorded folder falls back to the loader's folder | medium (hooks only) |
