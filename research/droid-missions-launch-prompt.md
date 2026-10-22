# Does launching droid with "/missions" start Mission planning without a model call?

Observed on Droid 0.238.0 (the floor), 0.245.0, and 0.247.0 (macOS arm64). Each binary matched Factory's published SHA-256 (`f7e94ff1…`, `150f9747…`, `852ae6cd…`). Every run used a throwaway `HOME`, a scratch git folder under `/tmp`, and a hooks-only `settings.json`. The account was signed in with an API key held in the child environment only. Shapes only: no ids beyond a prefix, prompts, transcripts, or settings contents.

## Question

1. **Command or text.** Whether an initial prompt of `/missions` runs as the slash command or goes to the model as plain text, for `droid "/missions"`, `droid --auto <level> "/missions"`, and `droid resume <id> "/missions"`.
2. **Planning.** Whether it enters Mission planning (`interactionMode` `mission` plus a `mission-session` tag) with no model call.
3. **Timing.** Whether `SessionStart` fires and whether the TUI takes the command before its input is ready.
4. **Versions.** Whether it works on the floor and on 0.245.0, else the user types `/missions`.

## Short answer

**`"/missions"` as the launch prompt runs as the slash command and makes no model call, but it does not enter Mission planning. It opens the Missions picker.** All nine launches (three versions, each plain, `--auto low`, and resume) ended on the same screen: the Missions list with "Begin new mission" focused. In every one `interactionMode` stayed `auto`, `tags` was empty, no `UserPromptSubmit` fired, tokens and credits were 0, and the Mission directory did not exist.

**The command waits for folder trust.** A folder not in `trustedFolders` shows "Trust this folder?" first. No `SessionStart` fires and no session exists until the dialog is answered. After one Enter the command ran. The prompt was held, not lost.

**Planning needs more keys.** One Enter on "Begin new mission" (0.245.0, a profile with no onboarding record) did not enter planning either. It opened an intro panel, "Missions - Autonomous Multi-Agent Execution", that warns of "significantly higher credit usage" and says "Press Enter to continue • Esc to return to default session". `interactionMode` was still `auto` and there was no tag. The run stopped there, so what the next Enter writes was not observed.

**A signed-out profile cannot be tested.** The signed-out TUI stops at "Please login" before it has an input box, and a wrong `FACTORY_API_KEY` ends the process. Neither creates a session or fires a hook, so the ticket's signed-out method cannot reach `/missions`. A signed-in run with nothing typed can.

**The fallback is not needed on these versions.** The floor behaves like 0.245.0 and 0.247.0. `droid "/missions"` is a shortcut to the picker, one Enter from "Begin new mission", not a way to start planning.

## Findings

### Runs

Each run sent one Enter, only while "Trust this folder?" was on screen (none for resume, whose folder was already trusted), and stopped after 40 to 45 s. `results.jsonl` has the rows.

| Droid | Invocation | Hooks | Screen at the end | `interactionMode` | Tags | Tokens, credits |
| --- | --- | --- | --- | --- | --- | --- |
| 0.238.0 | `droid "/missions"` | `SessionStart startup`, `SessionEnd other` | Missions picker | `auto` | none | 0, 0 |
| 0.238.0 | `droid --auto low "/missions"` | same | Missions picker | `auto` (autonomy `auto-low`) | none | 0, 0 |
| 0.238.0 | `droid resume <id> "/missions"` | `SessionStart resume`, `SessionEnd other` | Missions picker | `auto` | none | 0, 0 |
| 0.245.0 | same three | same three | Missions picker | `auto` | none | 0, 0 |
| 0.247.0 | same three | same three | Missions picker | `auto` | none | 0, 0 |

- **No `UserPromptSubmit` in any run.** A prompt that reached the model would have fired it.
- **`--auto low` took effect** (`autonomyLevel` `low`, `autonomyMode` `auto-low`) and did not change the picker.
- **`SessionStart` carries no `calling_session_id` or `previous_session_id`** and has the pane variables, as a normal start does. `source` is `startup`, or `resume` for the resume launch. `SessionEnd` `reason=other` came when the driver ended the process. No run exited on its own.
- **No auth file was written** (`FACTORY_DISABLE_KEYRING=1`), and no `missions` directory appeared.
- **Intro panel.** The extra probe, 0.245.0 only: trust Enter, then one Enter once "Begin new mission" showed. The screen read "/missions closed — mission onboarding required", then "Checking mission readiness…", then the panel. Settings, tags, tokens, and credits were as above, and `SessionStart` and `SessionEnd` were the only hooks.
- **Repo recorder.** One more `droid "/missions"` on 0.245.0 went through `config/scripts/capture-agent-pty-transcript.mjs` with a timed Enter at 12 s. It showed the same trust dialog, picker, hooks, and counters.

### Why: the code agrees

Read from the embedded JavaScript of each binary (static, so it supports the runs and does not replace them). The TUI takes `initialPrompt`, and an effect submits it once, when a readiness flag is set and the agent is `idle`. It goes through the same submit handler as typed input. A trimmed text that starts with `/` and is not path-like is a slash command. The `/missions` command loads the Missions and calls `showMissionsPicker`. This shape is present on all three versions.

The same bundle keeps a `hasSeenMissionOnboarding` setting. "Begin new mission" shows the intro panel when it is unset or when a "mission readiness" check is not `ok`, and the panel's Continue sets it. With the setting set and the check `ok`, the code goes on without the panel. That branch was not run: this profile never got past the panel.

[What hooks and session metadata does a Mission produce inside a Droid terminal session?](https://github.com/codeious/orca/blob/research/droid-mission-hooks/research/droid-mission-hooks.md) saw `interactionMode: "mission"` and the `mission-session` tag written at `/missions`, 5 s after `SessionStart` and before any prompt. That fits the picker plus Enter on a profile that had finished onboarding, but that note did not record the picker.

## Not checked

- The Enter after the intro panel, and Enter on "Begin new mission" in a profile that has already finished onboarding. Reaching the second needs the first in a throwaway profile, and the panel carries a credit warning, so neither was pressed.
- 0.245.1, the version the earlier Mission notes ran. 0.245.0 and 0.247.0 bracket it.
- `--auto` levels other than `low`, and the other resume flags (`-r`, `--resume`).
- Timing against input readiness. The runs have no timestamps for it. The code gates the prompt on the readiness flag and an `idle` agent.
- A launch from an Orca pane. The pane variable was a dummy value and Orca's real hook command did not run. Orca's `droid` entry in `tui-agent-config.ts` has `promptInjectionMode: 'argv'`, which was not exercised.
- Linux, Windows, WSL, and SSH hosts.

## Method

- **Profile.** `make-home.sh` builds a `HOME` whose only Factory file is a `settings.json` with a logging command on each hook event, plus a scratch git folder. The logger records event names, key names, and whether session ids relate, never their values.
- **Key.** `launch.py` reads the `FACTORY_API_KEY` line from a file into the child environment. It never reaches argv, a log, or a commit.
- **Driver.** `pty_drive.py`, adapted from `research/droid-subagent-session-start`, runs `droid` in a PTY and writes one Enter 1 s after a screen pattern appears (`--when`). The ticket named the repo recorder, which sends keys only at fixed offsets, so a slow start could miss the trust dialog. The matrix used the pattern driver and the recorder ran as a cross-check (`capture-crosscheck.sh`). The profile's hook logger works under either.
- **Reading.** `inspect.py`, `inspect-messages.py`, and `summarize.py` read the profile afterwards for settings keys, record types, tags, and token counters. `matrix.sh` runs the nine launches.
- **Not committed.** Raw PTY bytes stay under `/tmp`. `screens.txt` is rendered text with email-shaped strings masked. The recorder's own secret scan reported a plain email address as clean in a control file, so it was not relied on: the committed files were searched for the key value and its first characters, emails, and UUIDs, and none appeared.

## For the decision

- `droid "/missions"` is safe for Start Mission to launch: it costs no credits and starts nothing. It saves the user typing the command and nothing more.
- Start Mission cannot say "planning started" from the launch. The `mission-session` tag in the session's `.settings.json` is the check, and it appears only after the user goes on from the picker.
- Whether Orca sends the Enter on "Begin new mission" for the user is a separate choice. On a first run, the next screen is the credit warning, and a second Enter confirms it.
