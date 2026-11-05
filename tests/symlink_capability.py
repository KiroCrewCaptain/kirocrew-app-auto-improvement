"""Symlink helpers the tests ported from Kiro Crew's own tree import.

Kiro Crew's test tree reads these from its rootdir ``conftest``; this repository's
tests import them from here instead, so ``conftest`` is never imported as a module.
"""

from __future__ import annotations

import os
import tempfile

import pytest
from kiro_crew.testing.links import make_dir_link  # noqa: F401  (re-exported)


def _can_create_symlink() -> bool:
    """PROBE, never a platform guess: can this process create a real symlink?

    Creating one on Windows needs ``SeCreateSymbolicLinkPrivilege``, held by an
    elevated or Developer-Mode account (GitHub's Windows runners do) and not by
    an ordinary one.
    """
    with tempfile.TemporaryDirectory() as tmp:
        target = os.path.join(tmp, "target")
        os.mkdir(target)
        try:
            os.symlink(target, os.path.join(tmp, "link"))
        except (OSError, NotImplementedError, AttributeError):
            return False
        return True


requires_symlinks = pytest.mark.skipif(
    not _can_create_symlink(),
    reason="creating a symlink needs SeCreateSymbolicLinkPrivilege on Windows",
)
