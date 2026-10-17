# Does a Droid hook command's parent process identify the droid terminal process?

## Question

[What keeps a Droid session to one writer?](https://github.com/codeious/orca/issues/29) decided that a Droid terminal session gets its `live` / `unverifiable` / `exited` verdict from the `droid` process identity (pid and start time), captured by the hook the way Claude's hook script does (`src/main/agent-hooks/hook-process-capture.ts`). Today only Claude's hooks carry it, so `checkAgentPresence` returns `null` for a Droid row. Is the hook command's parent process the `droid` TUI, and can a hook record it reliably?

## Short answer

- **Yes, on macOS and Linux, on 0.238.0 and 0.244.0, for structured sessions (both OSes) and the terminal (macOS only).** Droid starts each hook through a shell, and that shell's parent is the `droid` process. The chain is `script sh` <- `command sh` <- `droid` <- launcher. No helper process sits between the command shell and `droid`.
- **The capture has to run in the command shell, not in the script.** In the script's shell, `$PPID` is the command shell. Claude's prefix `ORCA_HOOK_AGENT_PID="${PPID:-}"; export ORCA_HOOK_AGENT_PID;` runs in the command shell, and it gave `droid`'s pid every time.
- **Orca's own capture lines, unmodified, produced the right identity: 61 of 61 hooks.** The pid and start time (`darwin`: `ps -o lstart=`, `linux`: `/proc/<pid>/stat` field 22 plus `boot_id`) equalled the identity read from outside the process.
- **The identity is stable.** One `droid` process has one identity across `SessionStart`, `UserPromptSubmit`, `Stop`, `SessionEnd`, and `/new`. A resume in a new process is a new pid and start time with the same session id.
- **`SessionEnd` fires on every exit tried** (Ctrl-C, SIGTERM, SIGHUP, structured close). After exit the identity no longer resolves, so the verdict would be `exited`.
- **Two shapes break a Claude-shaped exit rule** and are left open:
  1. `/new` sends a second `SessionEnd` with `reason=other` for the old session, in the same second it starts the new one, while the process stays alive.
  2. In 3 of 14 terminal starts on 0.244.0 (0 of 4 on 0.238.0), no `SessionStart` hook ran, though `SessionEnd` did.
- **Windows and WSL were not run.** No Windows capture exists. A WSL distro runs its own presence check with `/proc` reads, so it is the Linux case, if the guest gets Droid's hook command.
- **A restored row saved before the capture has no identity**, so `checkAgentPresence` returns `null` and ADR 0007's `unverifiable` applies. No fallback is needed where the parent is the TUI.

## Evidence

### Setup

- Droid 0.238.0 (the floor) from its pinned release URL, checked against the published sha256, and 0.244.0 (the installed release). macOS arm64 natively, and Linux arm64 in a `node:24-slim` container (the `/proc` branch of the capture, which WSL guests and Linux SSH hosts run).
- A throwaway `HOME` per run, never the real `~/.factory`. Its only Factory file is a `settings.json` with a hook on nine events (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `Notification`, `PreCompact`, `PreToolUse`, `PostToolUse`). `FACTORY_DISABLE_KEYRING=1`, `FACTORY_DROID_AUTO_UPDATE_ENABLED=false`, and every `ORCA_*` variable except `ORCA_PANE_KEY` removed from the child environment.
- The hook command is `command-prefix.txt` plus `/bin/sh hook-chain.sh`. `capture.sh` and the prefix were generated from `hook-process-capture.ts` with `node --experimental-strip-types`, not retyped. The logger records the event name, an 8-character session id prefix, pids, start times, and command names. It never records the payload.
- **Structured half (free):** `droid exec --input-format stream-jsonrpc` with an invalid key. `initialize_session`, then one prompt that fails authentication (so `UserPromptSubmit` and `Stop` fire), then close. A second process then runs `droid.load_session` on the same id.
- **Terminal half:** the TUI in a pty with a real key read from a file into the child environment only. No message was submitted. The only input was Enter on an empty prompt box, `/new` plus Enter, and Ctrl-C. Exits were Ctrl-C twice, SIGTERM, and closing the pty master (SIGHUP, like closing a pane).
- No Mission was started. About 29 unrelated `droid` processes on the machine were left alone.

### Process chain

Every hook of every run matched this shape. The fourth entry is the launcher (`node` on macOS, the Python or Node main thread in the container).

| Surface | Hooks | Chain, innermost first | Orca capture equals outside identity |
| --- | --- | --- | --- |
| Structured, macOS 0.238.0 | 6 | sh, sh, droid, node | 6 of 6 |
| Structured, macOS 0.244.0 | 6 | sh, sh, droid, node | 6 of 6 |
| Structured, Linux 0.238.0 | 6 | sh, sh, droid, launcher | 6 of 6 |
| Structured, Linux 0.244.0 | 6 | sh, sh, droid, launcher | 6 of 6 |
| Terminal, macOS 0.238.0 | 11 | sh, sh, droid, pty driver | 11 of 11 |
| Terminal, macOS 0.244.0 | 26 | sh, sh, droid, pty driver | 26 of 26 |

The terminal was not run on Linux. The `droid` process had no child processes at rest in the TUI.

### Identity across events

- Structured: `SessionStart`, `UserPromptSubmit`, `Stop`, and `SessionEnd` all carried one identity per process. `droid.load_session` in a second process gave a new pid and start time and the same session id.
- Terminal `/new` (both versions): same pid and start time throughout. The order is `SessionEnd reason=clear` (old id), `SessionStart source=resume` (new id), then the extra `SessionEnd reason=other` (old id) below, all within the same second.
- Terminal `droid --resume <id>` in a new process: new pid, `SessionStart source=resume`, same session id.

### Exit

| Exit | `SessionEnd` | `droid` in the hook's chain |
| --- | --- | --- |
| Ctrl-C twice | `reason=other`, every run | present |
| SIGTERM | `reason=other`, in the second the signal was sent | present |
| Structured close | fires, no reason field | present |
| SIGHUP (pane close) | `reason=other`, every run | present in 3 of 9 runs, gone in 6 of 9 |

- When `droid` is gone by the time the hook runs, the captured pid is still right, because the command shell read `$PPID` when it started.
- After exit, `ps -p` and `/proc/<pid>` no longer resolve the pid in any run. Between exit and reaping, `ps` shows the process as `<defunct>`, which Orca's probe already counts as `exited`.
- The first SIGTERM run on 0.244.0 appeared to hang. My pty driver was not reading the pty while it waited. With a read loop the same case exited cleanly. A real pane host reads its pty, so I expect this not to apply, but I did not test an unread pty on purpose.
- Not run: SIGKILL or power loss. No hook can fire then, which is the case the identity exists for.

### Shapes that break a Claude-shaped exit rule

Orca's listener (`src/shared/agent-hook-listener.ts`) turns a `SessionEnd` that carries a process identity, has no `agent_id`, and has `reason` in `prompt_input_exit`, `logout`, `other`, `bypass_permissions_disabled` into "this process ended". Droid's exit reason is `other`, and its `/new` reason is `clear`, so the vocabulary lines up. Two observations do not.

**A late `SessionEnd other` after `/new`.** Identical on both versions (`hooks.jsonl`, tag `t1-new`):

| Second after launch | Hook | Session | Process |
| --- | --- | --- | --- |
| +14 | `SessionEnd reason=clear` | old | alive |
| +14 | `SessionStart source=resume` | new | alive |
| +14 | `SessionEnd reason=other` | **old** | alive, and still alive at +20 |
| +20 | `SessionEnd reason=other` | new | exits |

The `other` for the old session id arrives with a live process. A rule that reads `other` as "the process ended" would end the row while the TUI keeps running. The session id on that event is not the pane's current session.

**A missing `SessionStart`.** Across 18 terminal starts, `SessionStart` ran in 15. All 3 misses were on 0.244.0 (`t3-hup`, `rep1`, `rep2`; 11 of 14 started). The 4 starts on 0.238.0 all ran it. In every miss `SessionEnd` ran with the right identity, and in `t3-hup` the session file still appeared on disk (not checked for the other two). `hooks-ran.log` holds a breadcrumb written right after the hook reads stdin, and has no entry for a `SessionStart` in `rep1` or `rep2`, so the logger did not drop it: the hook never ran. In the other starts it ran at +1 s after launch. In the three first starts in a fresh `HOME` (`recon`, and `t1-new` on each version) it ran at +9 s, the second the script pressed Enter, so those do not separate "slow" from "waited for Enter". No cause was found. One guess is that Droid reads its org hook policy over the network and the start event can go out before it arrives (the same policy that can silence all hooks, per [Does an existing hooks.json stop Droid from loading Orca's settings.json hooks?](https://github.com/codeious/orca/issues/16)). That guess was not tested.

So the identity may first reach Orca on a later event, and until it does the row has no verdict.

### Windows, WSL, restored rows (read from code, not run)

- **Native Windows.** The capture is POSIX shell only (a `/proc` branch and a `ps` branch). `agent-process-presence-probe.ts` ends with "no Windows hook captures an identity yet" and returns `unverifiable`. Droid's Windows hook is a `.cmd` behind a PowerShell wrapper, and its script has no capture lines. ADR 0007 already treats a Windows Droid terminal as `unverifiable`.
- **WSL.** `src/wsl-guest/agent-hook-server.ts` runs `checkAgentPresence` inside the distro, so a guest hook with the capture is probed with the Linux `/proc` read, the case run here in a container. Not checked: whether Orca installs Droid's hook command into a WSL distro, and a real WSL run.
- **Restored rows.** `server-persistence-validation.ts` rebuilds `agentPresence` from the saved record with `readAgentProcessPresence`, which returns `undefined` for a record with no `agentPresence`. A row saved before the capture existed has none, so `checkAgentPresence` returns `null` (ADR 0007: `unverifiable`).
- **SSH.** Unchanged: once a row has an identity, `checkAgentPresence` returns `unverifiable` for a row with a `connectionId` before any local probe.

### Why no fallback is needed

`resolveAgentForegroundProcess` was meant for a parent that is not the TUI. Where this was run, the parent is the TUI, so the fallback is moot. It is not evidence for Windows.

### Not covered

- The installed Droid hook command (`wrapPosixHookCommand`, with its missing-script guard) was not the command that ran. The probe used Claude's prefix plus `/bin/sh <script>`. The prefix runs first in the command shell, so the later guard should not change `$PPID`, but I did not run the real wrapper.
- Linux terminal, Windows, WSL, SIGKILL, Droid versions between 0.238.0 and 0.244.0, and a Mission (whose workers run inside the TUI, [What does a live Mission do when steered, killed, and observed?](https://github.com/codeious/orca/issues/17)).
- Credits: no message was submitted in the terminal, and the structured prompts used an invalid key. I did not read the account balance.

## Fixtures

- `research/droid-hook-parent-process/hooks.jsonl`: every record from every run, one JSON object per line. `kind` is `hook` (a hook ran), `droid` (structured process, read from outside), or `tui` (terminal process, read from outside). `tag` names the run: `<version>/s1-init|s1-load` for structured (`linux-` prefix for the container), `tui-<version>/<scenario>` for the terminal. Every run is kept. `recon` (0.244.0) is the first look. 0.244.0 `t3-term` and `t3b-term` are the runs my driver stalled on (no `SessionEnd`), and `t3b-hup` and `t3c-term` are their reruns with the fixed driver.
- `research/droid-hook-parent-process/hooks-ran.log`: breadcrumbs from the six `rep` runs.
- `research/droid-hook-parent-process/probe/`: the logger, the profile builder, the generated capture lines, the structured and terminal drivers, and the renderer. `render.mjs hooks.jsonl <tag-prefix>` prints the chains. The drivers expect `/tmp/droid-31` paths and, for the terminal, `KEY_FILE` pointing at a file with a `FACTORY_API_KEY=` line.
- No key, home path, or user name is in any file.
