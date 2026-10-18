# Does a slow `SessionStart` hook delay or reorder the old session's `SessionEnd` `other` on `/tree` and `/resume <id>`?

## Question

[The previous note](droid-session-replacement-tree-resume.md) found no inversion in 180 switches, but its `SessionStart` and `SessionEnd` hook commands were both fast. It could not tell whether Droid waits for the `SessionStart` hook before it runs the `SessionEnd` hook, or launches both at once. ADR 0007's exit rule depends on that order on `/tree` and `/resume <id>`, because no `clear` guards it there.

When the `SessionStart` hook command is slow and the `SessionEnd` hook command is fast, does the old session's `SessionEnd` `other` still arrive at the listener after the new session's `SessionStart`?

## Short answer

**Yes up to about 10 seconds. Past that, no: the order inverts.**

- **Droid waits for a slow `SessionStart` hook, but only about 10 s.** It launches the `SessionEnd` hook shortly after the start hook exits (0.1 to 0.7 s later), or about 10 s after launching the start hook if that is still running. It does not stop the start hook at that point.
- **Delays of 9 s or less (224 switches): 0 inversions.** The gap between the two launches followed the delay (delay plus 0.1 to 0.7 s), not the 80 to 350 ms of the earlier note. The `SessionEnd` hook was launched after the start hook had posted in every switch.
- **Delays of 11 s or more (124 switches): 124 inversions.** The old session's `SessionEnd` `other` reached the listener before the new session's `SessionStart` in every switch, by 0.7 to 5.5 s. The start hook kept running and posted after its full delay.
- **Both commands and both versions.** At 15 s, `/tree` on 0.238.0, `/tree` on 0.244.0 and `/resume <id>` on 0.244.0 each had 36 of 36 inverted switches.
- **Printing before waiting changed nothing.** A hook that prints `{}` first and then waits 11 s inverted in 8 of 8 switches, the same as one that waits first.
- **A hook `timeout` below 10 s ends the wait sooner.** With `timeout: 2`, Droid sent SIGTERM to the start hook about 2 s in, the hook never posted, and the `SessionEnd` hook was launched 2.09 to 2.28 s after the start hook. With no `timeout`, the startup hook was sent SIGTERM at 59.6 s and 59.7 s, which matches the 60 s default in the [hooks guide](https://docs.factory.ai/cli/configuration/hooks-guide).
- **The process never changed and no credits were spent.** Across all 370 switches the `droid` process behind the hooks stayed the same, no `clear` was seen, `calling_session_id` was absent from every hook body, and no hook other than `SessionStart` and `SessionEnd` fired.

What this means for ADR 0007's exit rule is a later grilling decision and is not argued here. The measured fact is that, once a `SessionStart` hook takes longer than about 10 s, the old session's `SessionEnd` `other` can reach a listener before the new session's `SessionStart` while the `droid` process stays alive and no `clear` has been seen.

## Evidence

### Setup

Same probe as the earlier notes: a local listener that numbers each POST as its body is read, a throwaway `HOME` per process, a signed-in key held in the child environment only (`FACTORY_DISABLE_KEYRING=1`, auto-update off), and the driver from the previous note. Droid 0.244.0 is the installed release. Droid 0.238.0 is the local binary with sha256 `f7e94ff10eda09b0d3140b258899af72aabc136634413e2f62a73a92e40f2afc`, checked before use. macOS arm64. The key file was named by the user at run time. Its value is not in this note, the fixtures, or any argument list. The real `~/.factory` was not read or copied.

New in the probe:

- **A delay in the hook command.** `SS_DELAY_MS` makes the `SessionStart` hook wait that long. The `SessionEnd` hook never waits. `SS_DELAY_MODE=before` (default) waits before printing `{}`; `after` prints `{}` first and then waits.
- **A launch stamp in every hook.** The hook records the wall-clock time at its own first line. The listener records the wall-clock time of arrival next to its existing arrival number. Order is still the listener's arrival number. The stamps are only used for the launch gap and for how long a hook ran.
- **A `timeout` setting.** `HOOK_TIMEOUT_S` writes a `timeout` into each hook entry in the throwaway `settings.json`.
- **A lifecycle file.** The hook appends a row when it launches, a row if it survives its delay, and a row if it catches SIGTERM, SIGHUP or SIGINT. The hook writes these itself, so they exist even when it is stopped before it posts.

One fix before any counted run: the first launch stamps used the hook interpreter's monotonic clock. That clock is per process on the hook's `/usr/bin/python3` (3.9.6), so stamps from different hook processes, and from the listener's Python 3.13, could not be compared. They were replaced with wall-clock stamps. Nothing from the first attempt is counted.

The driver types only `/fork`, `/tree`, `/resume <id>` (0.244.0 only, enforced in code), Enter, arrow keys, Escape and Ctrl-C. No prompt was sent. No hook other than `SessionStart` and `SessionEnd` arrived in any capture (0 rows).

### Order, by delay

"Launch gap" is the `SessionEnd` hook's launch time minus the `SessionStart` hook's launch time. "Arrival gap" is the `SessionEnd` arrival minus the `SessionStart` arrival, so a negative value means `SessionEnd` arrived first. Rows of 36 switches are 3 fresh processes of 12 switches each.

| Delay | Command | Version | Switches | `SessionEnd` first | Launch gap ms (min / median / max) | Arrival gap ms (min / median / max) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 s | `/tree` | 0.238.0 | 36 | 0 | 1097 / 1132 / 1710 | 94 / 127 / 665 |
| 1 s | `/tree` | 0.244.0 | 36 | 0 | 1098 / 1130 / 1653 | 93 / 127 / 554 |
| 1 s | `/resume` | 0.244.0 | 36 | 0 | 1097 / 1140 / 1312 | 92 / 138 / 328 |
| 6 s | `/tree` | 0.238.0 | 36 | 0 | 6102 / 6156 / 6440 | 94 / 141 / 407 |
| 6 s | `/tree` | 0.244.0 | 36 | 0 | 6096 / 6181 / 6631 | 91 / 162 / 735 |
| 6 s | `/resume` | 0.244.0 | 36 | 0 | 6096 / 6154 / 6649 | 92 / 141 / 624 |
| 9 s | `/tree` | 0.244.0 | 8 (1 process) | 0 | 9129 / 9142 / 9176 | 124 / 132 / 187 |
| 11 s | `/tree` | 0.244.0 | 8 (1 process) | **8** | 10018 / 10140 / 10229 | −983 / −862 / −779 |
| 11 s, prints `{}` first | `/tree` | 0.244.0 | 8 (1 process) | **8** | 9997 / 10089 / 10279 | −1008 / −931 / −708 |
| 15 s | `/tree` | 0.238.0 | 36 | **36** | 9981 / 10061 / 10540 | −5045 / −4938 / −4452 |
| 15 s | `/tree` | 0.244.0 | 36 | **36** | 9887 / 10047 / 10566 | −5196 / −4962 / −4462 |
| 15 s | `/resume` | 0.244.0 | 36 | **36** | 9522 / 10039 / 10221 | −5468 / −4971 / −4773 |

Totals: 224 switches at 9 s or less, 0 with `SessionEnd` first. 124 switches at 11 s or more, 124 with `SessionEnd` first.

In every counted switch there was exactly one `SessionStart` (`source=resume`, with a `previous_session_id`) and one `SessionEnd` (`reason=other`), and the prompt came back afterwards. The `SessionStart` hook ran for its full delay each time (median 1.02 s, 6.02 s, 9.02 s, 11.02 s, 15.02 s), so it was not stopped at the 10 s mark. In the inverted rows the `SessionEnd` hook was launched 9.5 to 10.6 s after the start hook (median about 10.05 s) whatever the delay, which puts the cap at about 10 s. At 9 s the `SessionEnd` hook was launched after the start hook had posted in 8 of 8 switches. At 11 s it was launched before in 8 of 8. The cap was bracketed this way on 0.244.0 `/tree` only. The 15 s rows show the same launch gap on 0.238.0 `/tree` and 0.244.0 `/resume`.

### Process identity

`sameProcess` was true in all 370 switch markers (348 counted ones and 22 from the timeout runs below), and the prompt came back each time. All 35 processes then exited on their own after two Ctrl-C.

### Timeout and signals

Each row is one process. "Switch start hooks" are the `SessionStart` hooks launched by a switch, not by startup.

| Hook `timeout` | Delay | Command | Version | Switch start hooks | Signalled | Posted anyway | Ran before the signal ms (min / median / max) | `SessionEnd` launch after start launch ms (min / median / max) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 s | 6 s | `/tree` | 0.238.0 | 6 | 6 (SIGTERM) | 0 | 1884 / 1968 / 2013 | 2086 / 2196 / 2230 |
| 2 s | 6 s | `/tree` | 0.244.0 | 6 | 6 (SIGTERM) | 0 | 1921 / 1975 / 2023 | 2140 / 2170 / 2213 |
| 2 s | 6 s | `/resume` | 0.244.0 | 6 | 6 (SIGTERM) | 0 | 1949 / 1996 / 2011 | 2168 / 2193 / 2276 |
| none (60 s default) | 65 s | `/tree` | 0.238.0 | 2 | 2 (SIGTERM), later | 0 | 20295 / 26982 / 33669 | 10051 / 10070 / 10089 |
| none (60 s default) | 65 s | `/tree` | 0.244.0 | 2 | 2 (SIGTERM), later | 0 | 20363 / 26929 / 33495 | 10025 / 10065 / 10105 |

- **A `timeout` below 10 s ends the wait.** Droid signalled the hook at about the `timeout` and launched `SessionEnd` 0.1 to 0.3 s later. The hook caught SIGTERM. Whether Droid escalates to SIGKILL for a hook that ignores SIGTERM was not tried.
- **The 60 s default applies to the startup hook.** With a 65 s delay, the startup `SessionStart` hook got SIGTERM 59.6 s (0.244.0) and 59.7 s (0.238.0) after its first line. That is 0.3 to 0.4 s short of 60 s. The startup hooks in the `timeout: 2` runs got it 1.3 to 1.8 s in, 0.2 to 0.7 s short of 2 s. The shortfall is probably interpreter start-up before the hook's first line. That was not checked.
- **On a switch, Droid does not wait for the default 60 s.** With a 65 s hook and no `timeout`, `SessionEnd` was launched about 10.05 s after the start hook while the start hook kept running. Each of those switch start hooks then got SIGTERM 20 to 34 s in, within 0.2 s of a later `SessionEnd` launch (the next switch, then the exit): 0.14 s after it in the first case, 0.18 s before it in the second. Two hooks per version; the pattern is not established by this.

## Not covered

- Several hook commands on one event, including Orca's own. Whether Droid starts them together or one after another, and whether the 10 s wait is per command or for the whole event, was not tested. So it is open whether a user's slow `SessionStart` command can delay Orca's, or only a slow Orca command can.
- What would make Orca's own hook run past 10 s. A hook that waits on an unreachable endpoint is a plausible case. Nothing here ran Orca's command.
- Delays between 9 s and 11 s, and the exact limit. About 10 s is read from the launch gaps. A different start point for the timer cannot be told apart from this data.
- `/resume <id>` with a 65 s hook and no `timeout`. On `/resume`, the 10 s wait was seen only at the 15 s delay. `/resume` on 0.238.0 is not a slash command and was not typed.
- Whether the terminal accepts keys during the wait. Every switch completed and the prompt came back, but responsiveness during the wait was not measured.
- Escalation to SIGKILL, other events, and a `timeout` between 5 and 10 s or above 10 s combined with a longer delay. The 15 s rows used the 60 s default, which is the second case.
- Switches during a running turn or with a long conversation (needs prompts, which spend credits), Linux, Windows, WSL, SSH, and versions other than 0.238.0 and 0.244.0.

## Fixtures

All clock fields are rebased inside each capture, so no absolute time is committed. Session ids and process identity are relations (`S1`, `P1`). There is no prompt, path, pid, key or account name.

- `research/droid-session-replacement/slow-start-hooks.jsonl`: 783 listener rows from 17 captures, with `capture` added, plus `launchNs` and `delayMs` from the hook and `arrivalWallNs` from the listener.
- `research/droid-session-replacement/slow-start-switches.jsonl`: 405 driver markers (370 switches and 35 exits).
- `research/droid-session-replacement/slow-start-lifecycle.jsonl`: 1215 rows written by the hook command itself (launch, survived its delay, caught a signal).
- `probe/hook-log.py`, `probe/listener.py`, `probe/make-home.sh`, `probe/tree_resume_switches.py`: the probe with the delay, timeout and stamp settings. `EXPECT_START_MISSING=1` and `SLOW_WAIT_S` are for the timeout runs, where a hook is stopped before it posts or runs past the default limit.
- `probe/switch_order.py`: now also prints launch gaps and how many `SessionEnd` hooks were launched before the start hook posted. It still reproduces the previous note's table from the old fixtures exactly.
- `probe/timeout_check.py` and `probe/build_slow_start_fixtures.py`: the timeout summary and the script that built these fixtures.

Reproduce the two tables:

```
python3 research/droid-session-replacement/probe/switch_order.py --fixtures research/droid-session-replacement/slow-start-hooks.jsonl research/droid-session-replacement/slow-start-switches.jsonl
python3 research/droid-session-replacement/probe/timeout_check.py --fixtures research/droid-session-replacement/slow-start-lifecycle.jsonl research/droid-session-replacement/slow-start-hooks.jsonl
```

`switch_order.py` reports 0 switches for the five timeout captures, because no startup `SessionStart` ever posts there. Read those with `timeout_check.py`. Screen captures and the throwaway homes stayed in `/tmp` and are not in the commit.
