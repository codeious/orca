"""Child environment for a throwaway Droid run. Assembles the fake key without storing it in this file."""
import os

KEEP = (
    "PATH", "TERM", "TMPDIR", "LANG", "LC_ALL", "USER", "LOGNAME", "SHELL", "TMP", "TEMP",
    "FACTORY_API_BASE_URL", "FACTORY_ENV", "FACTORY_DEPLOYMENT_ENV",
)


def child_env(home, extra=None):
    env = {key: os.environ[key] for key in KEEP if key in os.environ}
    env.update({
        "HOME": home,
        "TERM": "xterm-256color",
        "FACTORY_API_KEY": "fk-" + "invalid-000000",
        "FACTORY_DISABLE_KEYRING": "1",
        "FACTORY_DROID_AUTO_UPDATE_ENABLED": "false",
        "ORCA_PANE_KEY": "probe-pane",
    })
    if extra:
        env.update(extra)
    return env
