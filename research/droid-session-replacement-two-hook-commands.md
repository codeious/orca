# Do two `SessionStart` commands change when the old session's `SessionEnd` `other` arrives?

## Question

[The previous note](droid-session-replacement-slow-start-hook.md) used one `SessionStart` command. It left open whether several commands on that event start together or one after another, and whether the about-10-second wait is per command or for the event. A user's slow command could then delay another command on the same event, or only a slow command of its own would matter.

When two commands share `SessionStart` and one of them waits past about 10 seconds, does the other command's post still reach the listener before the old session's `SessionEnd` `other`?

## Short answer

**Yes, when both commands are actually launched. They launch together, and the fast one's post is not held back by the slow one.**

- **Both commands launch together.** In `settings.json`, whether the two commands are in one matcher group or in two groups, and whether the slow command is listed first or second, the launch gap was −24.7 to +25.4 ms (median 0) across 288 switches. That is not a sequential start.
- **The fast command posts immediately.** Its `SessionStart` reached the listener 6065.6 to 6284.4 ms before `SessionEnd` at a 6 s delay (median 6110.7), and 9858.0 to 10626.5 ms before `SessionEnd` at a 15 s delay (median 10035.7). The fast post arrived before `SessionEnd` in 288 of 288 switches.
- **The about-10-second wait is unchanged, and it is not stacked per command.** At 6 s, `SessionEnd` was launched 6092 to 6279 ms after the slow command (median 6112), after the slow command had posted. At 15 s, `SessionEnd` was launched 9866 to 10616 ms after the slow command (median 10036), while the slow command was still running. The slow command then posted 4388.8 to 5139.1 ms after `SessionEnd` (median 4971.7), in 144 of 144 switches. A second ~10 s wait after the fast command would have pushed `SessionEnd` out by about that much. It did not.
- **`hooks.json` replaces `settings.json` for the event it defines.** It does not run both. With the slow command only in `hooks.json`, only that command launched, and `SessionEnd` inverted in 18 of 18 switches, the same as one slow command. With the fast command only in `hooks.json`, only that command launched, and `SessionEnd` was launched 91 to 174 ms later (arrival gap 89.7 to 176.1 ms, 0 of 18 inverted). `SessionEnd` was registered only in `settings.json` and still fired in every one of those 36 switches.
- **The process never changed.** `sameProcess` was true on all 288 counted switches and all 36 replacement switches. No hook other than `SessionStart` and `SessionEnd` fired. `calling_session_id` was absent on every listener row. No prompt was sent.

The fast command is a stand-in that posts `{}` at once. It is not Orca's hook, and this note does not say what Orca's own command would do. What the order means for ADR 0007's exit rule is not argued here.

## Evidence

### Setup

Same probe as the previous note: a local listener that numbers each POST as its body is read, a throwaway `HOME` per process, a signed-in key held in the child environment only, and the same driver. Droid 0.244.0 is the installed release. Droid 0.238.0 is the same local binary as the previous note, sha256 `f7e94ff10eda09b0d3140b258899af72aabc136634413e2f62a73a92e40f2afc`, checked again before these runs. macOS arm64. The key file was named by the user at run time. Its value is not in this note, the fixtures, or any argument list. The real `~/.factory` was not read or copied.

The [hooks guide](https://docs.factory.ai/cli/configuration/hooks-guide) says `settings.json` hooks are read when `hooks.json` is absent. These runs put `SessionEnd` only in `settings.json`.

New in the probe:

- **A `cmd` field, separate from `tag`.** `tag` still keys the session relations. `cmd` is `slow` or `fast`. The slow command waits `SS_SLOW_MS`. The fast command waits `SS_FAST_MS`, which was 0 in every counted run.
- **Three places in the throwaway home.** `entry`: one `SessionStart` group whose `hooks` array lists both commands. `entries`: two `SessionStart` groups in `settings.json`. `split`: one command in `settings.json` and the other in `hooks.json`. `slow-first` / `fast-first` is array order for `entry` and `entries`. For `split` it is file placement: `slow-first` puts the slow command in `settings.json` and the fast command in `hooks.json`.
- **`SessionEnd` stays one command** in `settings.json` and does not wait.

The counted design is smaller than the previous note: one process of 12 switches per cell, one Droid at a time. Cells are `entry` and `entries`, both orders, 6 s and 15 s, on `/tree` 0.238.0, `/tree` 0.244.0, and `/resume <id>` 0.244.0. That is 24 cells, 288 switches. The `split` cells are a replacement check, not part of the 288: the same three pairs, both placements, 15 s only, one process of 6 switches (36 switches).

The driver types only `/fork`, `/tree`, `/resume <id>` (0.244.0 only, enforced in code), Enter, arrow keys, Escape and Ctrl-C. `/resume` on 0.238.0 was not typed.

Not counted:

- The first `split` smoke dropped its tag. Two-command tags are longer than 40 characters, and the listener's token allowlist was `{1,40}`. It was widened to `{1,80}`. Nothing from that smoke is counted.
- Two later 1-switch `split` smokes showed that only the `hooks.json` command launched. They were not counted. The 6-switch cells below are the replacement check.
- Two 15 s `entry` attempts stopped with no switches (`typed command not on screen` on 0.238.0 `/tree`, `tree not on screen` on 0.244.0 `/tree`). The driver was changed to wait for the slow startup `SessionStart` to post before the first `/fork`, and those cells were run again from scratch. Only the reruns are counted.

### Both commands, 288 switches

Every cell had 12 switches, 12 windows of exactly two `SessionStart` commands (`source=resume`) and one `SessionEnd` (`reason=other`), 0 extra rows, `fastAfterEnd` 0, and `sameProcess` 12. The launch label is `parallel` and the wait label is `indistinguishable` in every cell, because the launch gap never reached the 500 ms the probe uses before it will call a wait per-command or per-event. The gaps below are the measurement.

"Launch gap" is the fast command's launch minus the slow command's launch. "End after slow" is the `SessionEnd` launch minus the slow command's launch. "Arrival gap" is the `SessionEnd` arrival minus that command's arrival, so a negative value means `SessionEnd` arrived first. Min / median / max, in milliseconds.

| Place | Order | Delay | Command | Version | Launch gap | End after slow | Slow arrival gap | Fast arrival gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| entry | slow-first | 6 s | `/tree` | 0.238.0 | -1 / 0 / 10 | 6104 / 6130 / 6222 | 98.6 / 123.4 / 203.4 | 6093.6 / 6130.6 / 6185.0 |
| entry | slow-first | 6 s | `/tree` | 0.244.0 | 0 / 0 / 5 | 6098 / 6120 / 6203 | 96.3 / 112.8 / 200.7 | 6097.6 / 6116.6 / 6216.4 |
| entry | slow-first | 6 s | `/resume` | 0.244.0 | -25 / 0 / 1 | 6115 / 6129 / 6244 | 108.7 / 121.8 / 234.6 | 6115.6 / 6132.2 / 6257.6 |
| entry | fast-first | 6 s | `/tree` | 0.238.0 | -1 / 0 / 1 | 6096 / 6115 / 6239 | 89.9 / 106.9 / 212.2 | 6094.9 / 6112.0 / 6237.3 |
| entry | fast-first | 6 s | `/tree` | 0.244.0 | -3 / 0 / 4 | 6094 / 6109 / 6142 | 88.1 / 104.2 / 131.7 | 6093.3 / 6108.9 / 6147.3 |
| entry | fast-first | 6 s | `/resume` | 0.244.0 | -1 / 0 / 1 | 6094 / 6100 / 6127 | 90.2 / 94.6 / 124.7 | 6094.8 / 6099.3 / 6128.4 |
| entry | slow-first | 15 s | `/tree` | 0.238.0 | 0 / 0 / 0 | 9973 / 10031 / 10048 | -5029.8 / -4981.0 / -4952.9 | 9971.9 / 10028.0 / 10048.9 |
| entry | slow-first | 15 s | `/tree` | 0.244.0 | -2 / 0 / 0 | 9866 / 10025 / 10074 | -5139.1 / -4987.1 / -4926.4 | 9858.0 / 10024.6 / 10075.9 |
| entry | slow-first | 15 s | `/resume` | 0.244.0 | 0 / 0 / 2 | 9961 / 10054 / 10335 | -5048.9 / -4953.0 / -4665.1 | 9962.1 / 10055.5 / 10344.1 |
| entry | fast-first | 15 s | `/tree` | 0.238.0 | 0 / 0 / 1 | 9969 / 10038 / 10112 | -5041.3 / -4965.0 / -4890.8 | 9910.7 / 10040.5 / 10114.0 |
| entry | fast-first | 15 s | `/tree` | 0.244.0 | -2 / 0 / 0 | 9910 / 10026 / 10067 | -5095.1 / -4975.6 / -4940.5 | 9901.7 / 10029.6 / 10066.3 |
| entry | fast-first | 15 s | `/resume` | 0.244.0 | 0 / 0 / 4 | 9920 / 10036 / 10100 | -5082.2 / -4974.6 / -4892.8 | 9913.8 / 10037.0 / 10113.5 |
| entries | slow-first | 6 s | `/tree` | 0.238.0 | -1 / 0 / 0 | 6095 / 6109 / 6203 | 90.5 / 106.0 / 206.6 | 6093.4 / 6110.4 / 6217.3 |
| entries | slow-first | 6 s | `/tree` | 0.244.0 | -3 / 0 / 2 | 6094 / 6102 / 6149 | 90.5 / 98.7 / 139.6 | 6087.7 / 6102.1 / 6149.1 |
| entries | slow-first | 6 s | `/resume` | 0.244.0 | -13 / 0 / 25 | 6092 / 6112 / 6279 | 90.0 / 105.5 / 238.3 | 6065.6 / 6107.7 / 6284.4 |
| entries | fast-first | 6 s | `/tree` | 0.238.0 | -2 / 0 / 1 | 6095 / 6110 / 6148 | 90.1 / 103.2 / 125.1 | 6094.5 / 6109.3 / 6147.7 |
| entries | fast-first | 6 s | `/tree` | 0.244.0 | -8 / 0 / 0 | 6099 / 6107 / 6199 | 93.5 / 102.1 / 189.3 | 6099.6 / 6108.0 / 6203.2 |
| entries | fast-first | 6 s | `/resume` | 0.244.0 | -5 / 0 / 7 | 6098 / 6108 / 6201 | 90.1 / 100.3 / 191.1 | 6084.9 / 6105.5 / 6201.1 |
| entries | slow-first | 15 s | `/tree` | 0.238.0 | 0 / 0 / 0 | 10003 / 10031 / 10100 | -5008.9 / -4977.4 / -4894.1 | 10001.6 / 10034.6 / 10114.8 |
| entries | slow-first | 15 s | `/tree` | 0.244.0 | -6 / 0 / 1 | 10008 / 10055 / 10616 | -4998.2 / -4958.3 / -4388.8 | 10008.8 / 10058.2 / 10626.5 |
| entries | slow-first | 15 s | `/resume` | 0.244.0 | 0 / 0 / 1 | 10001 / 10061 / 10273 | -4999.1 / -4948.3 / -4726.6 | 9997.5 / 10060.7 / 10283.3 |
| entries | fast-first | 15 s | `/tree` | 0.238.0 | 0 / 0 / 1 | 9971 / 10036 / 10335 | -5030.1 / -4970.4 / -4662.0 | 9962.6 / 10038.7 / 10340.9 |
| entries | fast-first | 15 s | `/tree` | 0.244.0 | 0 / 0 / 5 | 10016 / 10032 / 10092 | -4990.2 / -4976.8 / -4908.7 | 10015.6 / 10031.9 / 10080.0 |
| entries | fast-first | 15 s | `/resume` | 0.244.0 | -1 / 0 / 1 | 10008 / 10036 / 10082 | -5017.6 / -4973.3 / -4920.5 | 10007.2 / 10033.9 / 10089.6 |

Across the 144 switches at 6 s, `SessionEnd` was launched 6092 to 6279 ms after the slow command (median 6112). The slow command's post arrived 88.1 to 238.3 ms before that (median 105.3). The fast command's post arrived 6065.6 to 6284.4 ms before it (median 6110.7).

Across the 144 switches at 15 s, `SessionEnd` was launched 9866 to 10616 ms after the slow command (median 10036). The slow command's post arrived 4388.8 to 5139.1 ms after `SessionEnd` (median 4971.7). The fast command's post arrived 9858.0 to 10626.5 ms before `SessionEnd` (median 10035.7).

The slow command wrote a "survived" lifecycle row after its full delay on every launch, including the 15 s ones that posted after `SessionEnd`. Listing the slow command first or second did not change the launch gap or which post arrived first. One group and two groups did not either.

Each of the 24 processes then exited on its own after two Ctrl-C. That exit posted one more `SessionEnd` `other`, after the last switch window. Those 24 rows are not in the table.

### `hooks.json` replaces the `settings.json` command, 36 switches

`hooks.json` held only a `SessionStart` command. `settings.json` held the other `SessionStart` command and the `SessionEnd` command. Every cell had 6 switches, 6 windows of exactly one resume `SessionStart` plus one `SessionEnd` `other`, 0 extra rows, and `sameProcess` 6. The command that was only in `settings.json` never launched (0 lifecycle rows). The command in `hooks.json` launched 7 times per process (startup plus 6 switches) and, when it was the slow one, survived all 7.

| Placement | Command in `hooks.json` | Command | Version | Switches | That command after `SessionEnd` | End after that command ms | Arrival gap ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| slow in settings, fast in `hooks.json` | fast | `/tree` | 0.238.0 | 6 | 0 | 91 / 106 / 135 | 89.7 / 100.6 / 130.0 |
| slow in settings, fast in `hooks.json` | fast | `/tree` | 0.244.0 | 6 | 0 | 99 / 115 / 173 | 98.7 / 118.3 / 171.8 |
| slow in settings, fast in `hooks.json` | fast | `/resume` | 0.244.0 | 6 | 0 | 99 / 137 / 174 | 99.1 / 133.1 / 176.1 |
| fast in settings, slow in `hooks.json` | slow | `/tree` | 0.238.0 | 6 | **6** | 10001 / 10044 / 10090 | -5008.7 / -4977.8 / -4913.2 |
| fast in settings, slow in `hooks.json` | slow | `/tree` | 0.244.0 | 6 | **6** | 9981 / 10050 / 10118 | -5028.7 / -4957.6 / -4882.9 |
| fast in settings, slow in `hooks.json` | slow | `/resume` | 0.244.0 | 6 | **6** | 10005 / 10026 / 10084 | -5008.8 / -4971.9 / -4904.5 |

`SessionEnd` still posted from `settings.json` in all 36 switches even though `hooks.json` existed and had no `SessionEnd`. The six processes exited on their own after two Ctrl-C and posted one more `SessionEnd` `other` outside the switch windows.

## Not covered

- Orca's real hook command. The fast command only posts `{}`. A command that does other work before it posts was not run.
- More than two commands on one event, a fast delay other than 0, and delays other than 6 s and 15 s. The about-10-second point is the previous note's bracket, not a new one.
- A `hooks.json` that also defines `SessionEnd`, and plugin or org-managed hooks. Only a user-scope `hooks.json` with `SessionStart` was tried.
- A `timeout` on one of the two commands. These runs used the default.
- Whether the terminal accepts keys during the wait. The driver waited for the slow startup post before typing, after two attempts had stopped with no switches. Responsiveness during the wait was not measured.
- Three processes per cell. This note is one process of 12 switches (6 for the replacement check).
- `/resume` on 0.238.0, which is not a slash command and was not typed.
- Switches during a running turn or with a long conversation (needs prompts, which spend credits), Linux, Windows, WSL, SSH, and versions other than 0.238.0 and 0.244.0.

## Fixtures

All clock fields are rebased inside each capture, so no absolute time is committed. Session ids and process identity are relations (`S1`, `P1`). There is no prompt, path, pid, key or account name.

- `research/droid-session-replacement/two-cmd-hooks.jsonl`: 1020 listener rows from 30 captures.
- `research/droid-session-replacement/two-cmd-switches.jsonl`: 354 driver markers (288 counted switches, 36 replacement switches, and 30 exits).
- `research/droid-session-replacement/two-cmd-lifecycle.jsonl`: 1353 rows written by the hook command itself. Every slow launch has a matching survived row (333 of 333). The fast command does not wait, so it has launch rows only.
- `probe/hook-log.py`, `probe/listener.py`, `probe/make-home.sh`, `probe/tree_resume_switches.py`: the two-command probe. Unset `SS_PLACE` still writes the one-command `settings.json`.
- `probe/two_cmd_order.py` and `probe/two_cmd_self_test.py`: the counts, and the synthetic check that the old one-command table still matches.
- `probe/build_slow_start_fixtures.py`: now takes an optional prefix. `two-cmd` wrote the files above. The default prefix is still `slow-start`.

Reproduce the per-capture counts:

```
python3 research/droid-session-replacement/probe/two_cmd_order.py --fixtures research/droid-session-replacement/two-cmd-hooks.jsonl research/droid-session-replacement/two-cmd-switches.jsonl
```

Screen captures and the throwaway homes stayed in `/tmp` and are not in the commit.
