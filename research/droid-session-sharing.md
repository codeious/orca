# Does a structured Droid session share its session id and transcript with a terminal Droid session?

## Question

[How do Droid terminal sessions and structured Droid sessions coexist?](https://github.com/codeious/orca/issues/10) decided that a session moves between the two by Resume in new chat or `droid --fork`, with one writer, and that a live terminal blocks Resume in new chat. That rested on the assumption that both surfaces share one session. This note checks it on Droid 0.240.0: where each surface writes, whether the other can load and fork it, and what Droid does when two processes hold one session.

## Short answer

One session, one id, one file. A structured session (`droid exec --input-format stream-jsonrpc`) and a terminal session (`droid`) write the same transcript format into the same folder, and the file's UUID is the session id on both. `droid.load_session` opens a terminal session, and `droid --fork` / `droid exec --fork` copy either kind into a new id.

Droid enforces no single writer. A second process loads a session a live process holds, with no error and no lock, and its writes append to the same file. A live terminal does not notice them. So "a live terminal blocks Resume in new chat" is Orca's rule to enforce, and nothing in Orca enforces it for Droid today. Four things the spec must handle:

- **No lock, silent fork of history.** Two writers keep unique `seq` numbers but each chains `parentId` from the last message it saw, so the transcript becomes two chains in one file. The terminal that holds the session shows nothing of the other writer's messages and gives no warning.
- **Orca's ownership guard skips Droid.** The check that refuses a terminal resume while a chat owns a session covers Claude and Codex only. The Resume in new chat eligibility has no live-terminal reason at all, and refuses Droid outright today because Droid is not a provider-handle agent.
- **The vault parser counts hidden records.** Droid writes the tool catalog (`visibility: llm_only`) and error text (`visibility: user_only`) as ordinary `message` records. Orca's parser counts them, so a session that only ever failed to sign in looks resumable and its preview is the error text.
- **`droid.load_session` finds a session by id from any folder** and reports the folder it was recorded in. Whether tools then run there is untested.

## Findings

### Setup

- Droid CLI 0.240.0, `factoryProtocolVersion` `1.260.0`. macOS.
- Throwaway `HOME` and project folder under `/tmp`. `FACTORY_DISABLE_KEYRING=1`, `FACTORY_DROID_AUTO_UPDATE_ENABLED=false`. `ORCA_*`, `FACTORY_SESSION_ID`, and `FACTORY_UPSTREAM_CLIENT_TYPE` were removed from every child environment. No Mission was started.
- Most runs used an **invalid** `FACTORY_API_KEY`. A prompt then fails with `model_authentication_failed` and costs nothing, but Droid still writes the whole transcript, so the file format, load, fork, and second-writer behaviour can be read without credits.
- The interactive TUI exits at startup on an invalid key, so a terminal session needs a valid one. Those runs read the key from a file into the child environment only (`probes/with-key.sh`) and used a pty driver (`probes/pty_drive.py`). Two TUI processes with a valid key sent no prompt (zero cost: they only reach the prompt box). **One** prompt was sent, with the user's approval: "Reply with the single word OK. Do not use tools." on `gpt-6-luna`, reasoning effort `none`, pinned through a `--settings` overlay (`probes/tui-settings.json`). Droid answered `OK` in about 4 s. Cost, from `<session>.settings.json`: 352 input, 9 output, 10,412 cache-creation, 0 thinking tokens, **670 `factoryCredits`**.
- The first TUI launch in a new folder asks "Trust this folder?"; the answer is stored in the throwaway `HOME`.
- The vault parser was run with Orca's own `parseDroidSessionFile` (`probes/parse-with-orca-vault.ts`).

### 1. Where a structured session writes, and whether the vault reads it

- `droid.initialize_session` with no prompt already creates `~/.factory/sessions/<folder-slug>/<uuid>.jsonl` holding one `session_start` record (`id`, `title`, `owner`, `version: 2`, `cwd`, `hostId`), a sibling `<uuid>.settings.json`, and a row in the sqlite index `~/.factory/cache/session-index/index.db` (tables `sessions`, `session_spans`, `session_ingest`, `session_term_filters`). `<folder-slug>` is the **realpath** of the folder with `/` replaced by `-` (`-private-tmp-<probe-cwd>` for `/tmp/<probe-cwd>` on macOS).
- A terminal session writes the same layout. Reaching the TUI prompt box is enough to create the file (a `session_start` only, title `New Session`).
- Later records are `message` (`seq`, `parentId`, nested `message.content` blocks, optional `message.visibility`) and `agent_turn_outcome` (`reason`, for example `completed` or `model_authentication_failed`). A hidden `message` whose id begins `context-` and whose `visibility` is `llm_only` opens the session (tool catalog, skill list, and system info, about 9,600 characters). A forked copy wrote a new one when it took its first turn. Messages added later by a second process on the same session wrote none.
- A failed-auth turn still writes: the hidden context message, the user message, a `user_only` "Authentication failed…" message, and an `agent_turn_outcome`. The title is rewritten to the prompt text.
- The `cwd` in `session_start` differs by surface: a structured session stores the `cwd` it was initialized with (`/tmp/<probe-cwd>`), a terminal session and `droid.load_session` report the realpath (`/private/tmp/<probe-cwd>`). The folder slug is the realpath in both.
- Orca's parser (`src/main/ai-vault/session-scanner-droid-parser.ts`) reads both under the right id: `sessionId` equals the file name, and the title and `cwd` come from `session_start` and the first user message. The vault's two Droid roots are `~/.factory/sessions` and `~/.factory/projects`; this Droid wrote only to `sessions`, and nothing created `projects`.
- **Counting.** `consumeDroidMessage` (lines 131 to 151) counts every record with a user or assistant role and never reads `visibility`. The terminal session above has 3 records before any second writer (hidden context, user, assistant) and the parser reports `messageCount: 3`. A session that only failed auth reports the context and error rows as messages and previews the error text. `isAiVaultSessionResumableContent` (`src/shared/ai-vault-types.ts`, line 181) accepts `messageCount > 0`.

### 2. `droid.load_session` on a terminal session

- It succeeds and returns the 3 messages with `workingState: idle`. It writes nothing.
- The result has **no session-id field of its own**. The id is `result.session.id`, equal to the id the caller passed and to the file name. `cwd` comes back realpathed.
- The session is found by id whatever folder the loading process runs in. A process started in an unrelated folder loaded the session and reported the recorded folder. An unknown id gives `-32004` "Session not found". A `cwd` param on `droid.load_session` is accepted and ignored: the result still reports the recorded folder.
- `droid.update_session_settings` on a provider-locked session (`providerLock` / `apiProviderLock` are written to `<uuid>.settings.json` after the first real turn) accepted both a same-family model (`gpt-6.1-sol`) and an other-family model (`claude-fable-5.1`) with no error, and the response does not echo the model. One `compaction_state` record then appeared in the copy, written during that run: `summaryKind: provider_switch_serialization`, `removedCount: 6`, with a summary text and a `systemInfo` block that includes the folder, OS, `ls` output, and git status. The probe made the same-family change first and the other-family change second, so it does not show which of them wrote it.

### 3. Fork, both directions

| Fork | Source | Result |
| --- | --- | --- |
| `droid exec --fork <id>` (with a prompt) | structured session | New file, new id. `session_start.parent` is the source id and `forkedAtMessageId` names a message of the copy. Every source record is copied with its message ids; the fork's own prompt and records follow. Source file untouched. |
| `droid exec --fork <id>` (with a prompt) | terminal session | Same, copied messages keep their ids and their `userMessageSource: "cli_tui"`. New records carry no source. `forkedAtMessageId` is the assistant reply. |
| `droid --fork <id>` (interactive, no prompt) | structured session | Same `parent` / `forkedAtMessageId` linkage. The TUI replayed the stored history, including the "Authentication failed" rows. Source file untouched. |

- `forkedAtMessageId` is a label, not a cut. In the structured source, two chains ended after the anchor, and the copy kept both; the fork's next turn hung from the last row written (a `user_only` error), not from the anchor.
- Orca's `getAgentForkArgv` (`src/shared/agent-resume-argv.ts`, line 95) returns `null` for Droid, so Fork in terminal does not exist for Droid yet. `['droid', '--fork', id]` works on a session of either kind.

### 4. A second process on a session another process holds

- **No error, no lock.** Process B called `droid.load_session` on a session process A held, structured or terminal, and got the full session.
- **B's writes append to A's file.** A `droid.add_user_message` from B (invalid key, so no credits) wrote a user message, a `user_only` auth error, and an `agent_turn_outcome` straight into the terminal session's file. The file grew from 5 to 8 records.
- **Chains fork.** With two structured writers, `seq` never collided (it is read from the file when the record is written), but each writer chained `parentId` from its own last-seen message. The result is one file with two chains (the `structured-session` fixture: `seq 3-4-7-10` and `5-6-8-9` hang from a common message). A later `droid.load_session` returned all 11 messages, `seq` 0 to 10, in one list. Which chain a later model call sees was not tested.
- **The holder does not notice.** The terminal process kept the session open while B wrote. The TUI's captured output contains the text B wrote **zero** times. There is no reload and no warning. It exited cleanly with its resume hint.
- Also seen: one `<uuid>.settings.json` (plus `.bak`) written directly under `~/.factory/sessions/`, outside the folder slug, by a second process; and `.settings.json.bak` siblings next to most session files.

### What the TUI records that a structured session does not

- `userMessageSource: "cli_tui"` on the user and assistant messages.
- `sessionTitleAutoStage: "first_message"` and a model-written title (`OK`) on `session_start`.
- Assistant messages carry `modelId`, `apiProvider`, `openaiMessageId`, `openaiPhase`, and `reasoningEffort`.

## Orca code read (what the spec changes)

- `src/renderer/src/components/right-sidebar/ai-vault-session-resume-in-chat.ts`, `resolveAiVaultSessionResumeInChatEligibility` (line 61): the only reasons are `agent`, `already-structured`, `remote`, `empty`, `workspace`. There is no live-terminal reason. Droid gets `agent` because `AGENT_SESSION_PROVIDER_HANDLE_PROVIDERS` is `['claude', 'codex']` (`src/shared/agent-session-provider-handle.ts`, line 47). The cwd-must-match rule applies to Claude only (line 36).
- `src/main/ai-vault/structured-session-ownership.ts`: `findResumeOwnership` (line 133) and `parseResumeInvocation` (line 192) handle Claude and Codex. A terminal `droid --resume <id>` is never checked against a structured chat that owns the session. The guard runs one way only (a structured chat owns a session, so a terminal resume is refused); nothing checks a live terminal before a chat resumes.
- `src/shared/agent-resume-argv.ts`: Droid has a resume argv (`['droid', '--resume', id]`, line 47) and no fork argv (line 95).

## Not tested

- A second writer **during** a live model turn. Every second-writer run used an idle holder.
- `droid --resume <id>` in the TUI on a session a structured process created, with a real prompt. A TUI `--fork` of one and a TUI `--resume` of a terminal session were checked.
- Which folder tools run in when a session is loaded from a process in a different folder. Only the reported `cwd` was read.
- What a model call sees after two chains form (which chain, or both).
- Windows and WSL: the folder slug for `C:\…` and `\\wsl$\…` paths, and which side holds `~/.factory`.
- Droid versions other than 0.240.0, including the 0.238.0 floor.
- What writes `~/.factory/projects`, which the vault also reads.
- Whether the same-family or the other-family model change wrote the `compaction_state` record.

## Fixtures

`research/droid-session-sharing/fixtures/`:

- `structured-session.jsonl`: a structured session that only failed auth, with two concurrent writers (two `parentId` chains, `seq` 0 to 10).
- `terminal-session.jsonl` and `terminal-session.settings.json`: the terminal session with the one paid turn (records 0 to 4) and the second writer's appended records (5 to 7). The settings file holds the token usage, the credits, and the provider-lock fields.
- `structured-session-fork.jsonl`: `droid exec --fork` of `structured-session`.
- `terminal-session-fork.jsonl`: `droid exec --fork` of the terminal session before the second writer, followed by the provider-switch `compaction_state`.
- `empty-terminal-session.jsonl`: what reaching the TUI prompt box alone writes.

Scrubbed by `probes/scrub-transcripts.mjs`: record kinds, field names, order, `seq` and `parentId` links, and short user-visible strings are kept. Hidden context and tool-catalog text, compaction summaries and system info, `owner`, `hostId`, provider message ids, and the temp folder are replaced. Ids are renumbered consistently across files, so fork links still resolve. The raw transcripts, the pty captures, and the key were not kept.

`research/droid-session-sharing/probes/`:

- `lib.mjs`: spawns Droid, speaks JSON-RPC, snapshots the file tree with ids masked.
- `step1-init-only.mjs`, `step2-failed-turn-and-second-process.mjs`, `step3-concurrent-writers.mjs`, `step4a-check-pin.mjs`, `step5-load-tui-session.mjs`, `step6d-structured-writes.mjs`, `step6e-provider-lock.mjs`, `step7-other-cwd.mjs`, `step8-load-with-cwd.mjs`: the credit-free structured probes.
- `fork-report.mjs`, `outline.mjs`, `parse-with-orca-vault.ts`: read the forks and transcripts, and run Orca's parser.
- `pty_drive.py`, `render_screen.py`, `with-key.sh`, `run-tui-ready.sh`, `run-tui-paid.sh`, `run-step6.sh`, `tui-settings.json`: the terminal runs. `with-key.sh` needs `KEY_FILE`. `pty_drive.py` ends a child that ignores SIGTERM with SIGKILL after 3 s, because Droid's TUI does.

## Evidence log

- `droid --version` → 0.240.0. `factoryProtocolVersion` `1.260.0` in responses.
- Credit-free structured runs, invalid key: init only; failed turn; second process `load_session` and `add_user_message` against a held session; two concurrent writers; `exec --fork` of a structured session; `load_session` from another folder and with a `cwd` param.
- Terminal runs, valid key: trust dialog and prompt box with no prompt (zero cost); one paid prompt (670 credits); `exec --fork` and interactive `--fork` of the resulting sessions; a live TUI holding a session while a structured process wrote to it.
- Orca: the files named in "Orca code read", plus `src/main/ai-vault/session-scanner-agent-sources.ts` (Droid roots).

## Unknowns and risks

- Behaviour on future builds. Droid's transcript format and `droid.load_session` are not a published contract. The parser's field reads (`session_start.id`, `message.role`) are the only ones Orca depends on today.
- The silent second writer was seen with an idle holder. A holder mid-turn may behave differently, or interleave worse.
- The index (`index.db`) may serve Droid's own session list from rows Orca never sees. Whether a session Orca writes to the file appears in Droid's own list was not checked.

## Confidence

| Finding | Confidence |
| --- | --- |
| Structured and terminal sessions share folder layout, file, and id | high (both directions loaded, one paid terminal session) |
| `droid.load_session` takes a terminal session and reports no separate id | high |
| `--fork` / `exec --fork` copy either kind into a new id with `parent` linkage | high for the three runs; the anchor semantics medium |
| No lock, and a second process appends to the held session's file | high (structured holder and terminal holder) |
| The idle terminal never shows the other writer's messages | medium (one run) |
| Concurrent writers give two `parentId` chains in one file | medium (one run, two structured writers) |
| The vault parser counts hidden records | high (code and run agree) |
| A model change across provider families is accepted | high; that it writes `compaction_state` is medium (one run, two changes) |
| Terminal-session cost of 670 credits | measured once, on Droid 0.240.0 and `gpt-6-luna` |
