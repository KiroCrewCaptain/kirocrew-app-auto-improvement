"""The app's JSON writes survive a contended rename, as Windows reports one.

Ported from the auto-improvement case of Kiro Crew's
``test/test_windows_replace_retry_sweep.py``: ``store.write_json_atomic`` replaces
through the gateway's ``replace_with_retry``, so a sharing violation on the first two
attempts still lands the file and leaves no temp file behind. As there, two faults are
faked with ``IS_WINDOWS`` forced on and the backoff removed; this pins the wiring only,
not real OS behaviour.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from windows_sim import replace_sharing_violation

from auto_improvement.backend import store
from kiro_crew import atomic_write as aw
from kiro_crew import platform_compat


@pytest.fixture(autouse=True)
def _windows_without_backoff(_floor_monkeypatch: pytest.MonkeyPatch) -> None:
    _floor_monkeypatch.setattr(platform_compat, "IS_WINDOWS", True)
    _floor_monkeypatch.setattr(aw, "_REPLACE_BACKOFF_SECONDS", 0)


def _temps(directory: Path) -> list[str]:
    return sorted(p.name for p in directory.iterdir() if ".tmp" in p.name)


def test_auto_improvement_json_write_survives_a_contended_rename(tmp_path: Path) -> None:
    path = tmp_path / "ruler.json"
    with replace_sharing_violation(match="ruler.json", times=2) as sim:
        store.write_json_atomic(path, {"calibrated": True})

    assert sim["n"] == 3
    assert json.loads(path.read_text("utf-8")) == {"calibrated": True}
    assert _temps(tmp_path) == []
