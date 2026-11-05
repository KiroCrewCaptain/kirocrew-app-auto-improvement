"""Stand-ins for driving Kiro Crew's namespace launcher program in-process.

Copied from the helper half of Kiro Crew's ``test/test_sandbox_launcher_program.py``
(:func:`payload`, :class:`RecordingLibc`, :class:`CoveringLibc`, :func:`launch`,
:func:`refusal`), which its other launcher suites import. Here they serve the
parity tests between the launcher's refusal lines and this app's clone-probe
classifier (``tests/test_launcher_parity.py``).
"""

from __future__ import annotations

import ast
import ctypes
import errno
import os
import sys
from pathlib import Path
from typing import Any

import pytest

from kiro_crew import sandbox_launcher_program

try:
    import fcntl
except ImportError:  # Windows: the launcher never runs there, and the suites skip
    fcntl = None  # type: ignore[assignment]

program = sandbox_launcher_program

#: The stages pin targets through ``O_PATH`` and address them as ``/proc/self/fd/<n>``,
#: which only Linux has; the namespace launcher runs nowhere else.
pytestmark = pytest.mark.skipif(
    not sys.platform.startswith("linux"), reason="the namespace launcher is Linux-only"
)

_MS_BIND = 4096
_MS_REMOUNT = 32


def payload(**overrides: Any) -> dict[str, Any]:
    """A launcher payload with nothing to mask, plus *overrides*.

    The same keys :func:`kiro_crew.sandbox_plan.namespace_payload` emits, so a test
    states only the lists its case is about.
    """
    base: dict[str, Any] = {
        "real_uid": os.getuid(),
        "real_gid": os.getgid(),
        "sensitive_dirs": [],
        "seal_windowless_masks": [],
        "sensitive_dir_ids": {},
        "private_dirs": [],
        "private_dir_ids": {},
        "readonly_dirs": [],
        "writable_dirs": [],
        "sensitive_files": [],
        "fail_closed_file_masks": [],
        "alias_credential_ids": [],
        "required_mask_targets": [],
        "mask_occupants": {},
        "published_file_record": {},
        "crew_home_aliases": [],
        "expose_files": [],
        "env_prefixes": [],
        "ssh_dir": "/nonexistent-ssh-dir",
        "ssh_known_hosts": "/nonexistent-ssh-dir/known_hosts",
        "hide_ssh": 0,
        "sandbox_level": "strict",
        "unreadable_masks": [],
        "strict_host_key_opt": "",
        "stand_in_roots": [],
    }
    unknown = set(overrides) - set(base)
    assert not unknown, f"not a payload key: {sorted(unknown)}"
    base.update(overrides)
    return base


def rendered_payload(script: str) -> dict[str, Any]:
    """The plan data a rendered launcher carries: its one ``_PLAN = {...}`` line.

    For a test that reads back the file ``namespace_argv`` wrote; a test that builds the
    plan itself reads :class:`~kiro_crew.sandbox_plan.ConfinementPlan` fields instead.
    """
    lines = [line for line in script.splitlines() if line.startswith("_PLAN = {")]
    assert len(lines) == 1, "a rendered launcher carries exactly one plan line"
    return ast.literal_eval(lines[0][len("_PLAN = ") :])


class Call:
    """One ``mount(2)`` a stage made, with what its source and target reached then."""

    def __init__(self, source: object, target: object, fstype: object, flags: int) -> None:
        self.source = source
        self.target = target
        self.fstype = fstype
        self.flags = flags
        self.source_id = identity(source)
        self.target_id = identity(target)
        #: The path the target named when the mount was made.
        self.target_path = _resolved(target) if target is not None else None


_FD_PREFIX = "/proc/self/fd/"


def identity(path: object) -> tuple[int, int] | None:
    """``(st_dev, st_ino)`` of what *path* names right now, or ``None``.

    A ``/proc/self/fd/<n>`` spelling is resolved through its DESCRIPTOR, which is open
    while the stage calls ``mount``: ``fstat`` reaches the same object on every POSIX
    host, while the spelling itself resolves only where procfs exists.
    """
    if path is None:
        return None
    spelling = os.fsdecode(path) if isinstance(path, bytes) else str(path)
    try:
        if spelling.startswith(_FD_PREFIX):
            info = os.fstat(int(spelling[len(_FD_PREFIX) :]))
        else:
            info = os.stat(spelling)
    except (OSError, ValueError):
        return None
    return (info.st_dev, info.st_ino)


class RecordingLibc:
    """A libc that records every call and succeeds, or fails one chosen mount.

    *fail_at* is 1-based over ``mount`` calls; the failing call sets *fail_errno*.
    *prctl* may be set to ``None`` to stand in for a libc without prctl(2).
    """

    def __init__(self, fail_at: int | None = None, fail_errno: int = errno.EPERM) -> None:
        self.calls: list[Call] = []
        self.detached: list[str] = []
        self.unshared: list[int] = []
        self.prctls: list[tuple[int, ...]] = []
        self.fail_at = fail_at
        self.fail_errno = fail_errno

    def mount(self, source, target, fstype, flags, data):  # noqa: ANN001, ANN201
        self.calls.append(Call(source, target, fstype, flags))
        if self.fail_at is not None and len(self.calls) == self.fail_at:
            ctypes.set_errno(self.fail_errno)
            return -1
        return self.bound(source, target, fstype, flags)

    def bound(self, source, target, fstype, flags):  # noqa: ANN001, ANN201
        """What a successful mount does to the filesystem: nothing, here."""
        return 0

    def umount2(self, target, flags):  # noqa: ANN001, ANN201
        self.detached.append(os.fsdecode(target))
        return 0

    def unshare(self, flags):  # noqa: ANN001, ANN201
        self.unshared.append(flags)
        return 0

    def prctl(self, option, a2, a3, a4, a5):  # noqa: ANN001, ANN201
        self.prctls.append((option, a2, a3, a4, a5))
        return 0


def _resolved(path: object) -> str:
    """The path *path* names; a ``/proc/self/fd/<n>`` spelling is read off its descriptor."""
    spelling = os.fsdecode(path) if isinstance(path, bytes) else str(path)
    if not spelling.startswith(_FD_PREFIX):
        return spelling
    fd = int(spelling[len(_FD_PREFIX) :])
    getpath = getattr(fcntl, "F_GETPATH", None)
    if getpath is not None:  # Darwin: no procfs, but the descriptor knows its path
        return os.fsdecode(fcntl.fcntl(fd, getpath, bytes(1024)).split(b"\0", 1)[0])
    return os.readlink(spelling)


class CoveringLibc(RecordingLibc):
    """A libc whose binds HIDE their target, as a real mount does.

    A bind of a fresh stand-in over a name moves the object at that name aside and
    renames the stand-in onto it, on the same filesystem, so the name takes the
    stand-in's identity and everything beneath it is gone from every later look. A
    window's staging bind records the window; binding the stage back at the window's
    path inside a stand-in moves the window's real tree there. A bind of a path over
    itself (a seal, a carve-out) and every remount change nothing a ``stat`` can see.
    A private tmpfs is refused, so the unreadable-mask fallback is what runs.
    """

    def __init__(self, fail_at: int | None = None, fail_errno: int = errno.EPERM) -> None:
        super().__init__(fail_at, fail_errno)
        self.covered: list[str] = []
        self.aside: dict[str, str] = {}
        self.stages: dict[str, str] = {}
        #: Where a masked object is moved to, outside every tree a test inspects.
        self.aside_root: str | None = None

    def bound(self, source, target, fstype, flags):  # noqa: ANN001, ANN201
        if fstype == b"tmpfs":
            ctypes.set_errno(errno.ENOSYS)
            return -1
        if source is None or not flags & _MS_BIND or flags & _MS_REMOUNT:
            return 0
        src, tgt = _resolved(source), _resolved(target)
        if os.path.abspath(src) == os.path.abspath(tgt):
            return 0
        if src in self.stages:
            os.rename(self._current(self.stages.pop(src)), tgt)
            return 0
        if os.path.basename(tgt).startswith("kirocrew_sb_"):
            self.stages[tgt] = src  # a window staged: remember where its tree lives
            return 0
        assert self.aside_root is not None, "launch() sets the aside root"
        moved = os.path.join(self.aside_root, str(len(self.covered)))
        os.rename(tgt, moved)
        os.rename(src, tgt)
        self.aside[tgt] = moved
        self.covered.append(tgt)
        return 0

    def _current(self, path: str) -> str:
        """Where the object first seen at *path* lives now that masks moved its parents."""
        for original, moved in sorted(self.aside.items(), key=lambda kv: -len(kv[0])):
            if path == original or path.startswith(original + "/"):
                return moved + path[len(original) :]
        return path


def launch(
    tmp_path: Path,
    plan: dict[str, Any] | None = None,
    *,
    libc: RecordingLibc | None = None,
    environ: dict[str, str] | None = None,
) -> program.Launch:
    """A :class:`~kiro_crew.sandbox_launcher_program.Launch` whose stand-ins live in *tmp_path*.

    The stand-in root is set directly rather than chosen among ``/run/user`` and
    ``/dev/shm``, so every bind source shares a filesystem with the targets and
    :class:`CoveringLibc` can rename it into place.
    """
    stand_ins = tmp_path / "stand-ins"
    stand_ins.mkdir(exist_ok=True)
    libc = libc or CoveringLibc()
    if isinstance(libc, CoveringLibc) and libc.aside_root is None:
        aside = tmp_path / "under-masks"
        aside.mkdir(exist_ok=True)
        libc.aside_root = str(aside)
    execs: list[list[str]] = []
    run = program.Launch(
        plan or payload(),
        libc,
        environ={} if environ is None else environ,
        execvp=lambda file, args: execs.append([file, *args]),
    )
    run.tmpfs_src = str(stand_ins)
    run.src_prefix = "kirocrew_sb_%d_" % os.getpid()
    run.execs = execs  # type: ignore[attr-defined]
    return run


def refusal(stage, *args: object) -> str | None:  # noqa: ANN001
    """Run *stage* and return its refusal message, or ``None`` when it did not refuse."""
    try:
        stage(*args)
    except SystemExit as exc:
        return str(exc.code)
    return None
