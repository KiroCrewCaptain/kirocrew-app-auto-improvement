"""The clone probe classifies launcher failures by the lines Kiro Crew's launcher writes.

``clone_setup`` reads the stderr of a sandboxed ``git`` probe and must tell a launcher
death (the sandbox did not come up) from git's own refusal, or a real launcher failure
falls back to the misleading push-isolation refusal. It keys on the gateway's own
``sandbox.LAUNCHER_EXIT_PREFIXES`` and on the launcher's on-disk file name. These cases
are ported from the auto-improvement cases of Kiro Crew's
``test/test_sandbox_launcher_refusal.py`` and
``test/test_sandbox_launcher_import_hoist.py``: each prefix is produced by a real
launcher failure (the launcher program driven in-process with a stand-in libc,
``tests/sandbox_launcher_helpers.py``), and the classifier reads it the way the
gateway's own readers do.
"""

from __future__ import annotations

import errno
import os
from pathlib import Path

import pytest
from sandbox_launcher_helpers import RecordingLibc, launch, payload, refusal

from auto_improvement.backend import clone_setup
from kiro_crew import sandbox as sb
from kiro_crew import sandbox_launcher_program as program


def test_the_clone_probe_classifier_reads_the_sandbox_tuple() -> None:
    # Two spellings of what the launcher says would drift apart the first time the
    # launcher changed; the module that generates the launcher owns the one.
    assert clone_setup._LAUNCHER_EXIT_PREFIXES is sb.LAUNCHER_EXIT_PREFIXES


def test_a_failed_exec_is_a_launcher_failure_to_the_clone_probe(tmp_path: Path) -> None:
    """The clone probe's surfaced detail is the line that names the command; the
    gateway's own sandbox reader takes it for no refusal."""

    def missing(file: str, args: list[str]) -> None:
        raise FileNotFoundError(errno.ENOENT, os.strerror(errno.ENOENT))

    run = launch(tmp_path)
    run.execvp = missing
    line = refusal(program.exec_agent, run, ["/opt/tools/bin/glab", "api"])
    assert line is not None and line.startswith(sb.LAUNCHER_EXIT_PREFIXES)
    assert sb.launcher_refusal(line) is None
    assert clone_setup._launcher_failure_detail(line + "\n") == line


def _blocked(tmp_path: Path, _capfd: pytest.CaptureFixture[str]) -> str | None:
    """A ``sandbox: BLOCKED`` refusal: the propagation mount on ``/`` failing."""
    run = launch(tmp_path, libc=RecordingLibc(fail_at=1))
    c2p_r, c2p_w = os.pipe()
    p2c_r, p2c_w = os.pipe()
    os.write(p2c_w, b"x")
    try:
        # The stage closes its own two ends once the parent has answered, before the
        # mount it refuses on.
        return refusal(program.enter_namespaces, run, c2p_w, p2c_r)
    finally:
        os.close(c2p_r)
        os.close(p2c_w)


def _unshare(tmp_path: Path, _capfd: pytest.CaptureFixture[str]) -> str | None:
    """A ``sandbox: unshare(`` refusal: the user namespace cannot be created."""

    class _Refusing(RecordingLibc):
        def unshare(self, flags):  # noqa: ANN001, ANN201
            self.unshared.append(flags)
            return -1

    run = launch(tmp_path, libc=_Refusing())
    c2p_r, c2p_w = os.pipe()
    p2c_r, p2c_w = os.pipe()
    try:
        # Refused before the parent is signalled, so every end is still open here.
        return refusal(program.enter_namespaces, run, c2p_w, p2c_r)
    finally:
        for fd in (c2p_r, c2p_w, p2c_r, p2c_w):
            os.close(fd)


def _fatal(tmp_path: Path, capfd: pytest.CaptureFixture[str]) -> str | None:
    """A ``sandbox: FATAL`` line: ``~/.ssh/known_hosts`` exists and cannot be read."""
    ssh = tmp_path / ".ssh"
    ssh.mkdir()
    known = ssh / "known_hosts"
    known.write_text("h", encoding="utf-8")
    known.chmod(0)
    try:
        if os.access(known, os.R_OK):
            pytest.skip("this host can read a mode-0 file")
        run = launch(tmp_path, payload(hide_ssh=1, ssh_dir=str(ssh), ssh_known_hosts=str(known)))
        with pytest.raises(PermissionError):
            program.mask_ssh_keys(run)
    finally:
        known.chmod(0o600)
    return capfd.readouterr().err


def _no_command(tmp_path: Path, _capfd: pytest.CaptureFixture[str]) -> str | None:
    """A ``sandbox_launcher:`` refusal: the launcher started with no agent command."""
    return refusal(program.main, payload(), RecordingLibc(), [])


#: Each prefix the probe classifies on, and a launcher failure that emits it.
_EMITTERS = {
    "sandbox: BLOCKED": _blocked,
    "sandbox: FATAL": _fatal,
    "sandbox: unshare(": _unshare,
    "sandbox_launcher:": _no_command,
}


def test_every_probe_failure_marker_has_a_launcher_failure_behind_it() -> None:
    """The prefix list and the failures below are one set, so a new prefix gets one too."""
    assert set(_EMITTERS) == set(clone_setup._LAUNCHER_EXIT_PREFIXES)


@pytest.mark.parametrize("prefix", sorted(_EMITTERS))
def test_probe_failure_markers_round_trip_against_the_launcher(
    prefix: str, tmp_path: Path, capfd: pytest.CaptureFixture[str]
) -> None:
    """The probe's launcher-failure signature must track what the launcher emits.

    ``clone_setup._LAUNCHER_EXIT_PREFIXES`` classifies a nonzero probe exit as a
    launcher failure by the line it starts with; each prefix must start a line a real
    launcher failure writes, or the list has drifted and real launcher deaths fall back
    to the misleading push-isolation refusal this pairing exists to prevent.
    """
    emit = _EMITTERS[prefix]
    output = emit(tmp_path, capfd)
    assert output is not None, f"the launcher failure behind {prefix!r} did not happen"
    lines = output.splitlines()
    assert lines and lines[0].startswith(prefix), (
        f"no launcher failure line starts with the probe marker {prefix!r}: {output!r} -- "
        "update clone_setup._LAUNCHER_EXIT_PREFIXES together with the launcher"
    )
    if prefix == "sandbox: BLOCKED":
        assert "errno %d" % errno.EPERM in output


def test_the_traceback_marker_matches_the_launcher_filename() -> None:
    """The traceback-frame marker keys on the launcher's on-disk filename.

    A ROUND TRIP against a frame built from the two constants ``namespace_argv``'s
    ``mkstemp`` is passed -- never a pin on how ``sandbox_argv.py`` spells that call, which
    would fail on any refactor of the writer while real drift went unnoticed.
    """
    from auto_improvement.backend.clone_setup import (
        _LAUNCHER_TRACEBACK_RE,
    )
    from kiro_crew.sandbox import (
        _LAUNCHER_SCRIPT_SUFFIX,
        _SANDBOX_ARTIFACT_PREFIX,
        namespace_launcher_script_dir,
    )

    launcher_path = os.path.join(
        namespace_launcher_script_dir(),
        f"{_SANDBOX_ARTIFACT_PREFIX}4242_ab12cd{_LAUNCHER_SCRIPT_SUFFIX}",
    )
    frame = f'  File "{launcher_path}", line 1, in <module>'
    assert _LAUNCHER_TRACEBACK_RE.search(frame) is not None, (
        "the launcher's tempfile name does not match the traceback regex in "
        f"clone_setup (_LAUNCHER_TRACEBACK_RE); frame was {frame!r}"
    )
    # And it is still a TRACEBACK-frame match, not a bare substring: a repository may
    # legally be named after the prefix, which puts it in a clone path git echoes.
    assert _LAUNCHER_TRACEBACK_RE.search(f"fatal: could not read {launcher_path}") is None
    # The regex is keyed on THAT prefix and not on any crew-looking name, so a frame from
    # a differently-named file is not classified as a launcher death.
    other = launcher_path.replace(_SANDBOX_ARTIFACT_PREFIX, "kirocrew_other_")
    assert _LAUNCHER_TRACEBACK_RE.search(f'  File "{other}", line 1, in <module>') is None
