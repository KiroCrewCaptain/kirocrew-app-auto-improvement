"""A fetch killed by its timeout raises ``TimeoutExpired``; the stale-pack reap still runs.

Ported from the auto-improvement cases of Kiro Crew's ``test/test_git_tmp_packs.py``.
The timeout is the case that leaves an orphan ``tmp_pack_*`` in the clone, so a reap
that only ran when the fetch returned would miss every orphan these sites produce.
"""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Any

import pytest

from auto_improvement.backend import clone_setup, commit
from kiro_crew.git_tmp_packs import TMP_PACK_MAX_AGE_S

_OLD = 10 * TMP_PACK_MAX_AGE_S  # comfortably past any threshold under test


def _plant(pack_dir: Path, name: str, *, age_s: float = 0.0, size: int = 8) -> Path:
    pack_dir.mkdir(parents=True, exist_ok=True)
    target = pack_dir / name
    target.write_bytes(b"\0" * size)
    os.utime(target, (time.time() - age_s, time.time() - age_s))
    return target


def _plain_clone(tmp_path: Path) -> tuple[Path, Path]:
    clone = tmp_path / "clone"
    pack_dir = clone / ".git" / "objects" / "pack"
    pack_dir.mkdir(parents=True)
    return clone, pack_dir


def _timeout(args: Any, **kwargs: Any) -> Any:
    if "fetch" in args:
        raise subprocess.TimeoutExpired(args, kwargs.get("timeout") or 0)
    return subprocess.CompletedProcess(args, 0, "", "")


def test_clone_setup_checkout_branch_reaps_on_timeout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    clone, pack_dir = _plain_clone(tmp_path)
    old = _plant(pack_dir, "tmp_pack_killed", age_s=_OLD)
    monkeypatch.setattr(clone_setup, "require_pinned", lambda *_a, **_k: None)
    monkeypatch.setattr(clone_setup, "hook_off_args", lambda *_a, **_k: [])
    monkeypatch.setattr(clone_setup, "_repository_is_safe", lambda _c: True)
    monkeypatch.setattr(clone_setup, "_push_disabled", lambda _c: True)
    monkeypatch.setattr(clone_setup.subprocess, "run", _timeout)
    with pytest.raises(subprocess.TimeoutExpired):
        clone_setup.checkout_branch(clone, "feature/x")
    assert not old.exists(), "a timed-out fetch must not skip the reap"


def test_commit_materialize_reaps_on_timeout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    clone, pack_dir = _plain_clone(tmp_path)
    old = _plant(pack_dir, "tmp_pack_killed", age_s=_OLD)
    monkeypatch.setattr(commit, "resolve_origin_url", lambda _c: "https://example.invalid/r")
    monkeypatch.setattr(commit, "_prefer_authenticated_remote", lambda u: u)
    monkeypatch.setattr(commit, "_git", lambda _clone, *args, **kw: _timeout(args, **kw))
    with pytest.raises(subprocess.TimeoutExpired):
        commit.materialize_queued_diff(
            clone=clone, branch="main", config={}, diff_text="diff --git a/x b/x\n"
        )
    assert not old.exists(), "a timed-out fetch must not skip the reap"
