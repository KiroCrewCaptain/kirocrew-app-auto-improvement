"""The github_repo profile's measurement env passthrough uses the shared allowlist
convention, ``platform_compat.env_key_allowed``.

Ported from the auto-improvement cases of Kiro Crew's
``test/test_env_allowlist_consolidation.py``. The passthrough is written
upper-case-exact, so its parity oracle is exact membership on both platforms,
evaluated against the upper-cased key spelling a real Windows ``os.environ`` yields:
the shared fold must admit the same set. No credential-bearing name is admitted,
Kiro CLI's own included.
"""

from __future__ import annotations

import pytest

from auto_improvement.profiles.github_repo import profile as gh_profile
from kiro_crew import platform_compat

_POSIX_ENVIRON = {
    "PATH": "/usr/bin",
    "Path": "/sneaky-posix-lookalike",
    "SystemRoot": r"C:\Windows",
    "ComSpec": r"C:\Windows\System32\cmd.exe",
    "HOME": "/home/u",
    "LANG": "C.UTF-8",
    "TEMP": "/tmp",
    "GITHUB_TOKEN": "ghp_secret",
    "AWS_SECRET_ACCESS_KEY": "secret",
    "SLACK_BOT_TOKEN": "xoxb-secret",
    "SSH_AUTH_SOCK": "/tmp/agent.sock",
    "KIRO_API_KEY": "kiro-secret",
}

_WINDOWS_ENVIRON = {
    "PATH": r"C:\Windows\System32",
    "SYSTEMROOT": r"C:\Windows",
    "COMSPEC": r"C:\Windows\System32\cmd.exe",
    "USERPROFILE": r"C:\Users\me",
    "APPDATA": r"C:\Users\me\AppData\Roaming",
    "TEMP": r"C:\Temp",
    "HOME": r"C:\Users\me",
    "LANG": "C.UTF-8",
    "GITHUB_TOKEN": "ghp_secret",
    "AWS_SECRET_ACCESS_KEY": "secret",
    "SLACK_BOT_TOKEN": "xoxb-secret",
    "SSH_AUTH_SOCK": "/tmp/agent.sock",
    "KIRO_API_KEY": "kiro-secret",
}


def _environ_for(windows: bool) -> dict[str, str]:
    return _WINDOWS_ENVIRON if windows else _POSIX_ENVIRON


@pytest.mark.parametrize("windows", [True, False], ids=["windows", "posix"])
class TestMeasurementPassthrough:
    def test_the_passthrough_admits_exactly_its_own_oracle(
        self, monkeypatch, tmp_path, windows: bool
    ) -> None:
        monkeypatch.setattr(platform_compat, "IS_WINDOWS", windows)
        environ = _environ_for(windows)
        monkeypatch.setattr(gh_profile.os, "environ", dict(environ))
        env = gh_profile._measure_env(tmp_path)
        # _measure_env layers pinned measurement variables and PYTHONPATH on top of the
        # passthrough; only the keys sourced from the environ are the admitted set.
        admitted = set(env) & set(environ)
        assert admitted == {k for k in environ if k in gh_profile._MEASURE_ENV_PASSTHROUGH}

    def test_no_secret_is_admitted(self, monkeypatch, windows: bool) -> None:
        monkeypatch.setattr(platform_compat, "IS_WINDOWS", windows)
        for secret in ("GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "SLACK_BOT_TOKEN", "KIRO_API_KEY"):
            assert not platform_compat.env_key_allowed(secret, gh_profile._MEASURE_ENV_PASSTHROUGH)
