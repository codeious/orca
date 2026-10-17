"""Child environment for a throwaway Droid run. Reads KEY_FILE when set, and never prints the value."""
import os

KEEP = (
    "PATH", "TERM", "TMPDIR", "LANG", "LC_ALL", "USER", "LOGNAME", "SHELL", "TMP", "TEMP",
    "FACTORY_API_BASE_URL", "FACTORY_ENV", "FACTORY_DEPLOYMENT_ENV",
)


def load_key():
    path = os.environ.get("KEY_FILE", "")
    if not path:
        return "fk-" + "invalid-000000"
    with open(path) as handle:
        for raw in handle:
            line = raw.strip()
            if line.startswith("export "):
                line = line[len("export "):]
            if line.startswith("FACTORY_API_KEY="):
                value = line.split("=", 1)[1].strip().strip("\"'")
                if value:
                    return value
    raise SystemExit("key file had no key")


def child_env(home, extra=None):
    env = {key: os.environ[key] for key in KEEP if key in os.environ}
    env.update({
        "HOME": home,
        "TERM": "xterm-256color",
        "FACTORY_API_KEY": load_key(),
        "FACTORY_DISABLE_KEYRING": "1",
        "FACTORY_DROID_AUTO_UPDATE_ENABLED": "false",
        "ORCA_PANE_KEY": "probe-pane",
    })
    if extra:
        env.update(extra)
    return env
