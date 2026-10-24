# What a signed-out `droid` terminal looks like to Orca

Ticket: [What does a signed-out droid terminal look like to Orca, for a scheduled run stuck at the login screen?](https://github.com/codeious/orca/issues/48)
Branch: `research/droid-signed-out-screen` (never merged, no PR).

## Question

A scheduled Droid automation runs on a host where Droid is signed out. What does the pane show, what does Orca's run observer see, and which lines stay the same across versions, so a later rule can fail the run as "not signed in"?

## Short answer

- **The login screen is inline and static.** `droid` paints it in about 5 s, then prints nothing for as long as it was watched (150 s), with the `droid` process still alive. It is not an alt-screen. Same on 0.249.0 and 0.238.0.
- **Nothing in Orca's status path reacts.** No hook fires (0 events), no browser launch is attempted, no OSC 9999 is sent, and the agent-status store holds 0 rows for the pane. The only signal is the pane title `⛬ Droid`, which Orca reads as agent `droid` with no status.
- **It is not a 2-minute idle success.** The ticket feared the run observer would complete the pane after 2 minutes with no agent status. Replaying the recordings through the real observer shows `tui-idle` never becomes true for a pane Orca launched as `droid`, so the 2-minute path in `judgeIdleRun` is never reached. The run stays `dispatched`, the observer re-arms a 5-minute wait 72 times, and at exactly 6 h it returns `dispatch_failed` with "Orca stopped watching this run after 6h without a completion signal." The cost of no rule is a six-hour hang and a message that does not name the cause, not a false success.
- **A made-up `FACTORY_API_KEY` ends the process.** About 6 s in, the pane prints `Authentication failed. FACTORY_API_KEY is set but appears to be invalid. Unset it or replace it with a valid key.`, `droid` exits, and the shell prompt `$` remains. Orca's result is the same as for the login screen: `tui-idle` never holds and the run ends at 6 h.
- **The command-line prompt is not shown by Droid.** The marker string appears once in every prompt recording, as the shell's own echo of the typed command. It never appears inside the login UI. Whether Droid keeps it for after a login cannot be seen without signing in.
- **Stable match candidates** (both versions, 120x40 and 80x24): `Please login with your Factory account to continue.` and the three menu rows `> Login`, `  Sign into a Factory Private deployment`, `  Exit`. For a wrong key, the full `Authentication failed…` sentence. Wording of the rule is a build task.

## Scope and method

- macOS arm64, host `droid` 0.249.0 (newest at the time) and 0.238.0, both downloaded to a scratch directory and checked against Factory's published `.sha256`. The user's installed `droid` was never run.
- Throwaway `HOME` with no credentials and no read of any real `~/.factory`. Clean environment, `FACTORY_DISABLE_KEYRING=1` (as Orca does in isolated profiles), auto-update off. The only settings file is a hook logger that records key names.
- `open`, `xdg-open` and `wslview` were stubbed to record a launch attempt and open nothing.
- The pane is an interactive `bash` with `droid` typed into it, as an Orca pane is. Cases: `bare` (`droid`), `prompt` (`droid "ORCA-PROBE-PROMPT-q7"`), `auto-prompt` (`droid --auto high "…"`, 0.249.0 only), and `badkey-bare` / `badkey-prompt` with `FACTORY_API_KEY=fk-made-up-for-signed-out-probe-0000`.
- No case could reach a model. Nothing was typed after the launch line, and Enter was never pressed on the login menu.
- Captures use `config/scripts/capture-agent-pty-transcript.mjs`. Timing runs use a PTY driver that also records each read's arrival time and the descendant process names.
- The replay feeds the timed recordings into the repo's transcript pane harness, a real `AgentHookServer` status store, and the real `createRuntimeAutomationRunTerminalObserver`, under fake timers. The foreground process is mocked: `droid` until the `Authentication failed` line is read, then `bash`.

## Findings

### 1. The login screen

Final emulator rows, 0.249.0, 120x40 (a rounded box sits above them):

```
Please login with your Factory account to continue.
> Login
  Sign into a Factory Private deployment
  Exit
```

| Line | Same on both versions and both grids? | Use as a match? |
| --- | --- | --- |
| `Please login with your Factory account to continue.` | yes | candidate |
| `> Login`, `  Sign into a Factory Private deployment`, `  Exit` | yes | candidate |
| `Welcome to Factory CLI` | yes | no: not checked on a signed-in start |
| TIP line | no | no |
| Version string (`v0.249.0`, `v0.238.0`) | no, it names the version | no |
| Skills row (`Connectors` only on 0.249.0) | no | no |
| ASCII logo | no, it wraps away at 80x24 | no |

Match against the rendered screen (`readTerminal` with `screen: true`), not the raw bytes: in the raw transcript the escapes and wrapping interleave with the text.

### 2. Hooks, status store, OSC

- Hook events at the login screen: **0** in every run, including the 150 s run. Browser-launch stub calls: **0**. No auth file was written.
- OSC sequences in all ten captures: kind `7501` once, kind `11` (background query) once, kind `0` (title) once, `⛬ Droid`, arriving 2.2 to 3.0 s after spawn. No OSC 9999. Alt-screen enter and leave both `(0, 0)`.
- Orca classifies `⛬ Droid` as agent `droid` with status `null`. Only `Droid ready` is an explicit idle title, and `⛬ Droid - action required` is `permission`. `getTuiAgentRestSignal('droid')` is `synthetic-title`, and that `Droid ready` title is something Orca's own hooks write. The login screen never fires a hook, so it never appears.
- The status store has writers for hooks, structured ingest, and `ingestTerminalStatus` (OSC 9999 and a process-lifetime producer). The only process-lifetime producer is for OpenCode, not Droid. So the pane has **0 agent-status rows**.

### 3. Wrong `FACTORY_API_KEY`

- Bare and prompt, both versions: `droid` prints `Authentication failed. FACTORY_API_KEY is set but appears to be invalid. Unset it or replace it with a valid key.` and exits. No `droid` process is left at the end of any wrong-key run. The sentence is read at 5.57 to 5.92 s, and that is when the replay flips its mocked foreground from `droid` to `bash`.
- Final screen is exactly two rows: that sentence, then `$`. The shell stays up, so the pane does not close.
- Only a made-up string was tried. A real but revoked key may print different wording.

### 4. The prompt on the command line

The marker `ORCA-PROBE-PROMPT-q7` appears **once** in each of `prompt`, `auto-prompt` and `badkey-prompt`, and that one is the shell echoing the typed command. The login screen never shows it, and no input box exists to hold it. Nothing in the pane says whether Droid keeps it for after a login, and that cannot be seen without signing in.

### 5. `tui-idle` and timing

Timing runs (parallel, macOS arm64):

| Case | Length | Hooks | Title at | Last output at | Silence to the end | `droid` at the end |
| --- | --- | --- | --- | --- | --- | --- |
| both versions `bare` | 150 s | 0 | 2.2 to 3.0 s | 5.1 to 5.9 s | about 144.5 s | alive |
| both versions `prompt`, 0.249.0 `auto-prompt` | 60 s | 0 | 2.2 to 3.0 s | 5.1 to 5.9 s | to the end | alive |
| both versions `badkey-*` | 60 s | 0 | 2.2 to 3.0 s | 5.1 to 5.9 s | to the end | gone, shell up |

Replay through the real observer (`replay-results.json`, test `replay-signed-out.test.ts`):

| Horizon | Cases | `tui-idle` satisfied | Status rows | Observer result |
| --- | --- | --- | --- | --- |
| 130 s (past the 2-minute grace) | all 9 | never | 0 | none yet, and no 5-minute wait has timed out yet |
| 6 h 10 min (past the observer's 6 h cap) | 0.249.0 `bare`, 0.249.0 `badkey-bare`, 0.238.0 `bare` | never | 0 | 72 waits time out (first at 300,000 ms), then `{status: 'dispatch_failed', error: 'Orca stopped watching this run after 6h without a completion signal.'}` at exactly 21,600,000 ms |

Why `tui-idle` never holds:

- The login screen has no agent status and no `Droid ready` title.
- Droid's rest signal is `synthetic-title`, so the quiet-foreground lane is closed for it. Silence alone does not count as idle, however long it lasts.
- In the wrong-key case the bare `$` is not a known-ready prompt anchor, so the shell prompt does not count either, even after `droid` leaves the foreground.
- `judgeIdleRun` (2-minute `AGENT_START_GRACE_MS`) runs only after a satisfied `tui-idle` wait, so it is never reached here.

Controls: a committed Cline recording (`cline-3-0-66-ready`) satisfies `tui-idle` through the same harness in 10 s, so the harness can see an idle pane. Setting the pane title to `⛬ Droid` and calling `readTerminal({ screen: true })` first changed nothing.

## What this leaves for the rule (not decided here)

- No hook, status row or title can carry "not signed in". Only the rendered screen text can.
- A rule that waits for `tui-idle` first never gets to speak, because that wait does not resolve. It has to read the screen on its own schedule, well before 6 h.
- The wrong-key pane has no `droid` process at all, while the login pane has a live one. Whether the rule treats these as one case or two is a build decision.

## Limits

- macOS arm64 only. Linux, Windows, WSL and SSH were not run.
- Two versions, one account state (signed out, no keyring, no keychain entry). The default keyring path was not exercised, because `FACTORY_DISABLE_KEYRING=1` was set.
- Orca itself was not launched. The foreground process is a mock, and the scheduler is not in the loop. The observer and status store are the real code from `origin/main` at `d3417b257f`.
- The `> Login` and `Sign into a Factory Private deployment` options were not selected, so what they do, and whether they open a browser, is unobserved.
- A signed-in Droid whose session expires mid-run might paint the same lines. That was not observed.

## Files

- `research/droid-signed-out-screen/capture/`: ten scanner-clean captures with `.meta.json` (0.249.0 and 0.238.0 at 120x40, plus 0.249.0 `bare` at 80x24 and `auto-prompt`). Each `.txt` keeps escapes and wrapping.
- `research/droid-signed-out-screen/replay/`: nine timed recordings (`.txt` plus `.timing.json` of `[ms, UTF-16 length]` reads), 0 redactions.
- `research/droid-signed-out-screen/replay-signed-out.test.ts`: the replay. Copy it to `src/main/runtime/` to run, because vitest only globs `src/**`: `pnpm exec vitest run src/main/runtime/<copy>.test.ts`.
- `research/droid-signed-out-screen/replay-results.json`: the numbers above.
- `research/droid-signed-out-screen/build-replay-fixtures.mjs`: builds the timed recordings from the timing runs.
- `research/droid-signed-out-screen/probe/`: `run-case.sh` (`ORCA_REPO=<checkout> PROBE_ROOT=<dir> sh run-case.sh capture|timing <version> <case> <seconds> [cols rows]`, needs `$PROBE_ROOT/bin/<version>/droid`), the hook logger (key names only), the PTY timing driver, the `open` stub and `analyze.py`.
