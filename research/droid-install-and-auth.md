# How is Droid installed, signed in, and run headless on each host?

## Question

For macOS, Linux, Windows, WSL and SSH remotes: how is Droid installed, where does the binary land, how does sign-in work (`FACTORY_API_KEY`, files and keychain entries under `~/.factory`), how are updates handled, and what can Orca detect without prompting (installed, version, signed in)?

## Short answer

Droid is one CLI, `droid` (`droid.exe` on Windows). macOS and Linux install with `curl -fsSL https://app.factory.ai/cli | sh` into `$HOME/.local/bin/droid`; macOS also has `brew install --cask droid` into `$HOMEBREW_PREFIX/bin/droid`; Windows is `irm https://app.factory.ai/cli/windows | iex` into `%USERPROFILE%\bin\droid.exe`; npm is `npm install -g droid` or `npm install -g @factory/cli`. WSL is the Linux install inside the distro. An SSH remote is whichever of those the remote OS is.

Headless is `droid exec` on every host. Sign-in is an interactive browser `/login`, or `FACTORY_API_KEY` for non-interactive runs. Credentials live in `~/.factory` (`%USERPROFILE%\.factory` on Windows) and, unless disabled, in the OS credential store (macOS login keychain via `auth.v2.loginkeychain`, otherwise keytar as `auth.v2.keyring`).

Orca today only detects that a command named `droid` is on PATH (plus a bounded install-dir fallback). It does not read a Droid version or a signed-in bit. A version gate should key off `droid --version`, which prints a single semver line, not off `~/.factory/last-startup-version`.

## Findings

### Per-host matrix

| Host | Install | Binary | Sign-in | Headless |
| --- | --- | --- | --- | --- |
| macOS | curl script, or Homebrew cask, or npm, or a pinned download | `$HOME/.local/bin/droid`, or `$HOMEBREW_PREFIX/bin/droid`, or the npm global bin | Browser `/login`, or `FACTORY_API_KEY`. Login keychain file `~/.factory/auth.v2.loginkeychain` | `droid exec` |
| Linux | Same curl script (uname Linux), or npm, or a pinned download. The Homebrew cask is macOS-only | `$HOME/.local/bin/droid`, or the npm global bin | Same env and files under `~/.factory`. OS store is keytar (`auth.v2.keyring`), not the macOS keychain path | `droid exec` |
| Windows | `irm https://app.factory.ai/cli/windows \| iex`, or npm, or a pinned `droid.exe` | `%USERPROFILE%\bin\droid.exe`, or the npm global bin | `FACTORY_API_KEY` in PowerShell or CMD. Files under `%USERPROFILE%\.factory` | `droid exec` (`droid.exe`) |
| WSL | The Linux curl script inside the distro. A Windows `droid.exe` is a different install | Distro `$HOME/.local/bin/droid` | The distro user's `~/.factory` and that distro's OS credential store, not the Windows profile | `droid exec` inside the distro |
| SSH | Whatever the remote OS documents above | On that remote user's `PATH` | That remote user's `~/.factory` and OS store. The local Mac's keychain is not the remote login | `droid exec` on the remote |

Confidence: high for the documented commands and paths; medium for "WSL uses the Linux script" (inferred from `uname`, not from a WSL-specific doc).

### Install

Documented commands, from the quickstart markdown (the HTML tabs only render the first one):

- macOS/Linux: `curl -fsSL https://app.factory.ai/cli | sh`
- Homebrew: `brew install --cask droid`
- Windows: `irm https://app.factory.ai/cli/windows | iex`
- npm: `npm install -g droid`

Source: https://docs.factory.com/droid-cli/quickstart.md

The curl script (`https://app.factory.ai/cli`, fetched 2026-10-11) accepts only Darwin and Linux, x64 and arm64. x64 without AVX2 downloads the `x64-baseline` build. It verifies SHA256, `chmod +x`, copies to `$HOME/.local/bin/droid`, and `pkill -KILL -x droid` first. It does not edit the shell rc; if `$HOME/.local/bin` is missing from `PATH` it prints the `export` line. Its non-Unix error string still says `irm https://yourdomain.com/cli/windows | iex`. The script that `https://app.factory.ai/cli/windows` actually returns is the real installer. Current pinned download version in both scripts: `0.238.0`.

The Windows script installs `droid.exe` to `%USERPROFILE%\bin`, creates that directory, stops processes named `droid`, and appends the directory to the user `Path`. x64 without AVX2 uses `x64-baseline`.

Homebrew cask `droid` version `0.238.0` (`https://github.com/Homebrew/homebrew-cask/blob/master/Casks/d/droid.rb`): `depends_on :macos`, `auto_updates true`, `binary "droid"` (so `$HOMEBREW_PREFIX/bin/droid`), URL `https://downloads.factory.ai/factory-cli/releases/#{version}/darwin/#{arch}/droid`. Zap list includes both `~/.factory` and `~/.local/bin/droid`, so a cask install and a curl install can both exist.

Direct pins, from https://docs.factory.com/docs/droid-cli/cli-reference :

```
https://downloads.factory.ai/factory-cli/releases/<version>/<platform>/<arch>/<binary>
https://downloads.factory.ai/factory-cli/releases/<version>/<platform>/<arch>/<binary>.sha256
```

`<platform>` is `linux`, `darwin`, or `windows`. `<arch>` is `x64`, `arm64`, or `x64-baseline`. `<binary>` is `droid` or, on Windows, `droid.exe`.

npm: the quickstart and the CLI reference (`npm install -g droid@0.174.0`) name the package `droid`. The registry also publishes `@factory/cli` at `0.238.0`, and its readme says `npm install -g @factory/cli`. Both readmes say the command on `PATH` is `droid`. On this Mac the installed binary is `/Users/noter/.local/bin/droid`, which matches the curl destination, not a Homebrew or npm prefix (`droid --version` → `0.238.0`).

Linux quickstart note: install `xdg-utils` "for proper functionality." The page does not say headless `droid exec` requires it.

### Sign-in and where credentials live

Interactive: the quickstart says the TUI prompts to sign in via the browser. Slash commands include `/login` and `/logout` (https://docs.factory.com/docs/droid-cli/cli-reference).

Non-interactive: set `FACTORY_API_KEY` from https://app.factory.ai/settings/api-keys. `droid exec --help` on the installed 0.238.0 prints the three shells:

- macOS/Linux: `export FACTORY_API_KEY=...`
- Windows PowerShell: `$env:FACTORY_API_KEY="..."`
- Windows CMD: `set FACTORY_API_KEY=...`

The same CLI reference says to persist that variable in the shell profile. Service accounts for CI authenticate with an API key (https://docs.factory.com/enterprise/identity-and-access.md). The binary's unauthenticated error is: "Not authenticated. Please log in using /login or set a valid FACTORY_API_KEY environment variable." A set but rejected key is a different error: "Authentication failed. FACTORY_API_KEY is set but appears to be invalid."

Settings are not the login. User settings are `~/.factory/settings.json` on macOS and Linux, and `%USERPROFILE%\.factory\settings.json` on Windows (https://docs.factory.com/docs/droid-cli/settings). Org policy can also be a system file: macOS `/Library/Application Support/Factory/settings.json`, Linux and WSL `/etc/factory/settings.json`, Windows `C:\Program Files\Factory\settings.json` (https://docs.factory.com/docs/enterprise/hierarchical-settings-and-org-control).

Credential files, from strings in the installed `0.238.0` binary and from names (not values) in this machine's `~/.factory`:

- `auth.json` — JSON keys `access_token`, `refresh_token`. Still named in the binary's sensitive-file list.
- `auth.v2.loginkeychain` — macOS login-keychain store. Save log line: "Saved credentials to auth.v2.loginkeychain". The binary calls `/usr/bin/security` and is linked to `SecKeychainAddGenericPassword` / `SecKeychainFindGenericPassword`. If the keychain is unavailable it says the login was saved to disk and tells the user to run `security unlock-keychain` (the doctor-style remediation names `~/Library/Keychains/login.keychain-db`).
- `auth.v2.keyring` — keytar store. Default service name string is `Factory CLI`. Save log: "Saved credentials to auth.v2.keyring".
- `auth.v2.file` plus `auth.v2.key` — encrypted file plus key file ("keyfile-v2"). The binary errors if `auth.v2.file` exists and `auth.v2.key` is missing. Save log: "Saved credentials to auth.v2.file".
- `auth.v2.write.lock` — write lock name.
- `FACTORY_DISABLE_KEYRING=1` — documented in the binary as the switch that stores credentials on disk when the OS store is blocked. Non-macOS remediation text says "OS credential store" and does not name libsecret or Windows Credential Manager.

This Mac has `auth.json`, `auth.v2.file`, `auth.v2.key`, and `auth.v2.loginkeychain` all present. Which one the process reads was not determined; values were not read.

`host.json` keys (no values): `schemaVersion`, `hostId`, `createdAt`, `computerRegistration.computerId`, `computerRegistration.firestoreOrgId`, `computerRegistration.userId`, `computerRegistration.registeredAt`. Those are identifiers, not the API key.

`droid doctor` was not run. `--help` describes connectivity, certificate, proxy, auth, and daemon probes and a network `--timeout`. That is not a read-only local check.

### Headless run

`droid exec` is the non-interactive command on every platform (https://docs.factory.com/droid-exec/overview and `droid exec --help`). Default is read-only. `--auto low|medium|high` opts into edits and commands. `--skip-permissions-unsafe` skips prompts; command blocks still apply; it cannot be combined with `--auto`. `--mission` requires `--auto high` or `--skip-permissions-unsafe`. Exit `0` on success, non-zero on failure. `--output-format text|json|stream-json|stream-jsonrpc`. No platform-specific exec flag appears in the help.

An exec that needs a model and has neither a saved login nor `FACTORY_API_KEY` fails with the unauthenticated error above. Validating the key contacts the Factory API (binary: "FACTORY_API_KEY could not be validated because the Factory API is not accessible").

### What Orca can already detect

Detection is "is the command on PATH", not version and not auth.

- The catalog entry is `detectCmd: 'droid'` with no alias, no `detectUnsupportedRuntimes`, and no auth preflight (`src/shared/tui-agent-config.ts:252-258`).
- `preflight.detectAgents` resolves the workspace host, then probes that command list (`src/main/runtime/rpc/methods/preflight.ts:19-26`, `src/main/preflight/agent-detection.ts:147-157`).
- Local: `isCommandOnPath`, then for misses `detectCommandsInInstallDirs` (`src/main/preflight/agent-command-detection.ts:32-47`). Windows PATH lookup honors `PATHEXT`, so `droid.exe` matches the bare name `droid` (`src/main/ipc/command-path-resolver.ts`).
- Fallback dirs include `~/.local/bin` on POSIX and Windows, plus npm/pnpm/volta/asdf/mise/bun locations (`src/shared/node-cli-command-resolution.ts`, `getBaseVersionManagerDirectories`). They do not include the generic `~/bin` the Windows installer uses (`src/shared/system-cli-install-dirs.ts` calls that a deliberate gap, and returns no system dirs on `win32`). A Windows install is visible only when `%USERPROFILE%\bin` is on the PATH Orca searches.
- WSL: login `PATH` inside the distro, plus the POSIX fallback list that includes `$HOME/.local/bin`, skipping `/mnt` Windows paths so a Windows `droid.exe` is not reported as the guest CLI (`src/main/ipc/preflight-wsl-agent-detection.ts`, `src/shared/posix-version-manager-bin-dirs.ts`). Guest commands go through `buildWslExecArgs` (`--exec`, not `--`) so `wsl.exe` does not expand `$HOME` (`src/shared/wsl-login-shell-command.ts:19-30`).
- SSH: the relay looks up the bare command via the remote login shell, or `where.exe` on a Windows OpenSSH host (`src/wsl-guest/preflight-handler.ts`, `buildCommandLookupSpecs`). An unreachable host throws; it is not reported as "no agents" (`src/main/preflight/agent-detection.ts:221-230`).
- Version: the relay runs `--version` only for `claude` when `reportVersion` is set (`src/wsl-guest/preflight-handler.ts:87-95`). The shared command builder never sets `reportVersion` (`src/shared/tui-agent-detection-commands.ts`). `detectInstalledAgents` returns ids only. gh/glab auth checks exist; there is no Droid equivalent (`src/main/preflight/agent-detection.ts`, `isGhAuthenticated`).

So without prompting, Orca can already answer "installed" when `droid` resolves. It cannot answer version or signed-in.

Safe checks that do not print secrets, from this run and the docs:

- Installed: the PATH / install-dir probe above.
- Version: `droid --version` / `droid -v`. On 0.238.0 the stdout is the single line `0.238.0`.
- Signed-in, weak and local: a non-empty `FACTORY_API_KEY` in the environment the process will inherit, or the presence of `auth.json` / `auth.v2.*`. Presence is not a valid session. Reading those files exposes tokens. `droid doctor --auth` can talk to the network; it was not used.

### Version gate and updates at runtime

Key the comparison off `droid --version`. Do not key it off `~/.factory/last-startup-version`: that file exists and, on this machine, contains `0.216.0` while `droid --version` is `0.238.0`.

Update controls, from https://docs.factory.com/docs/droid-cli/cli-reference and strings in 0.238.0:

- Standalone installs auto-update. `droid update` installs; `droid update --check` only checks; `droid update --version <semver>` installs or rolls back.
- `FACTORY_DROID_AUTO_UPDATE_ENABLED=false` disables the in-process updater and makes `droid update` refuse to install. The variable must be set for every process, including `droid daemon`.
- npm builds ship with auto-update disabled. `droid update` then reports auto-update unavailable. The binary's manual-update hint says `npm update -g @factory/cli`, not `droid`. `FACTORY_DROID_AUTO_UPDATE_ENABLED=true` overrides the npm build default.
- Org setting `disableAutoUpdate` disables CLI auto-update. Local `~/.factory/update-policy.json` has the key `disableAutoUpdate` (boolean; `false` on this machine). A snapshot the binary cannot read is treated as auto-update disabled until a refresh rewrites it.
- Runtime strings: "Post-input-ready auto-update completed" and, for the daemon, a forced auto-update that restarts the daemon if it finishes before a startup deadline. The on-disk binary can change under a long-lived process; the running process does not pick up the new build until restart.

No product minimum version is stated here. Nothing in the docs or in Orca names the oldest `droid` that structured sessions or Missions require.

### Orca isolated profiles and the login keychain

Orca's isolated Electron profile (E2E / `orca serve` with `ORCA_E2E_USER_DATA_DIR` or `ORCA_E2E_HOME_DIR`) passes `--password-store=basic` and `--use-mock-keychain` so Chromium does not block on a login keychain that the fresh `HOME` does not have (`src/shared/electron-isolated-profile-switches.ts:1-20`). That is Orca's browser profile, not Droid's store.

Droid's own macOS path does use the login keychain (`auth.v2.loginkeychain`, `security unlock-keychain`). If that keychain is locked or missing, the binary saves the login to disk under the `HOME` it was started with. The headless Orca server separately does not use the OS keychain for Orca's own secrets (`src/main/orcad/orcad-secret-protection-gap.ts`).

## Evidence log

- `gh issue view 7 -R codeious/orca`
- `droid --help`, `droid --version` → `0.238.0`, `command -v droid` → `/Users/noter/.local/bin/droid`, `droid update --help`, `droid doctor --help`, `droid exec --help`. `droid doctor` was not run.
- Fetched: `https://app.factory.ai/cli`, `https://app.factory.ai/cli/windows`, `https://docs.factory.com/droid-cli/quickstart.md`, `https://docs.factory.com/droid-exec/overview`, `https://docs.factory.com/docs/droid-cli/cli-reference`, `https://docs.factory.com/docs/droid-cli/settings`, `https://docs.factory.com/docs/enterprise/hierarchical-settings-and-org-control`, `https://docs.factory.com/enterprise/identity-and-access.md`, Homebrew cask `droid.rb`, npm pages for `droid` and `@factory/cli`.
- Filenames and JSON key names only under `~/.factory`. No secret values recorded.
- Printable strings from the local `0.238.0` binary for `auth.v2.*`, `FACTORY_API_KEY`, `FACTORY_DISABLE_KEYRING`, `update-policy.json`, and the auto-update messages. Account identifiers were not copied.
- Orca source in this worktree, paths cited above.

## Unknowns and risks

- Which of `auth.json`, `auth.v2.loginkeychain`, `auth.v2.keyring`, and `auth.v2.file` wins when more than one exists was not executed. Reading them would expose tokens.
- The binary never says "libsecret" or "Credential Manager". Non-macOS storage is "OS credential store" via keytar. The exact Linux and Windows backing store is unverified.
- `droid` and `@factory/cli` are both on npm at `0.238.0`. Docs tell users to install `droid`; the updater tells them to update `@factory/cli`. Which package name a given npm install used is not visible from `droid --version`.
- The curl script's Windows error string still contains `yourdomain.com`. The documented and fetched installer URL is `https://app.factory.ai/cli/windows`.
- `droid doctor --auth` may be enough for a signed-in check, but `--help` does not promise it stays local. It was not run.
- No source names a minimum Droid version for Orca structured sessions or Missions.
- Reinstalling with the curl or Windows script kills every process named `droid`.
- A Windows install into `%USERPROFILE%\bin` is invisible to Orca's install-dir fallback until that directory is on PATH.
- A WSL guest and the Windows host do not share `~/.factory`. Probing only one of them will mis-report the other.
- An SSH session uses the remote account's Droid login. Loss of SSH is not evidence the remote `droid` exited; Orca already treats an unreachable host as unverifiable for detection.

## Confidence

| Finding | Confidence |
| --- | --- |
| Install commands and binary paths for macOS, Linux, Windows | high |
| Homebrew cask is macOS-only and auto-updates | high |
| WSL is the Linux install inside the distro; Windows `droid.exe` is separate | medium |
| SSH is just the remote OS's install and that user's `~/.factory` | high |
| Headless command is `droid exec` everywhere, read-only unless `--auto` | high |
| `FACTORY_API_KEY` or browser `/login` are the two auth sources | high |
| Credential file names and the macOS login-keychain path | high |
| Linux/Windows OS-store implementation behind keytar | low |
| Orca detects `droid` on PATH only; no version, no signed-in | high |
| Version gate should parse `droid --version`, not `last-startup-version` | high |
| How auto-update replaces the binary and can restart the daemon | high |
| A numeric minimum version for Orca features | not determined |
