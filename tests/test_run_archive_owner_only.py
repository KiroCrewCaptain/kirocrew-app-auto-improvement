"""The run archive is owner-only (``0600`` files, ``0700`` directories) where the app
actually writes it: ``store.results_dir()`` under the app's data directory.

Ported from the auto-improvement case of Kiro Crew's ``test/test_owner_only_files.py``.
"""

from __future__ import annotations

import os
import stat
from collections.abc import Iterator
from pathlib import Path

import pytest

from auto_improvement.backend import store
from auto_improvement.spine.archive import Archive
from kiro_crew import platform_compat
from kiro_crew.config.paths import config_dir

pytestmark = pytest.mark.skipif(not platform_compat.IS_POSIX, reason="POSIX mode bits")


@pytest.fixture(autouse=True)
def _umask_022() -> Iterator[None]:
    previous = os.umask(0o022)
    try:
        yield
    finally:
        os.umask(previous)


def _mode(path: Path | str) -> int:
    return stat.S_IMODE(os.lstat(path).st_mode)


def _readable_by_others(root: Path) -> list[str]:
    """Every file or directory under *root* with a group/other bit, links excluded."""
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        for name in dirnames + filenames:
            path = Path(dirpath, name)
            st = os.lstat(path)
            if stat.S_ISLNK(st.st_mode):
                continue
            if stat.S_IMODE(st.st_mode) & 0o077:
                found.append(f"{oct(stat.S_IMODE(st.st_mode))} {path.relative_to(root)}")
    return found


def test_auto_improvement_run_archive_is_owner_only(shipped_data_home: Path) -> None:
    """Through the root the supervisor passes (``store.results_dir()``), not a tmp dir."""
    home = Path(config_dir())
    root = store.results_dir()
    assert shipped_data_home in root.parents
    assert home in root.parents
    archive = Archive(root)
    archive.write_meta({"run": 1})
    archive.save_candidate(cand_id="c1", diff="--- a\n+++ b\n", detail={"k": "v"})
    archive.append_row({"status": "kept"})
    archive.write_drift(1, {"note": "x"})

    assert _readable_by_others(home / "apps") == []
    assert _mode(root / "results.tsv") == 0o600
    assert _mode(root / "candidates.jsonl") == 0o600
    assert _mode(root / "candidates" / "c1.diff") == 0o600
