"""Test-suite fixtures for the auto-improvement app.

## Why a git identity is forced here

Several tests drive PRODUCTION commit paths (``backend/commit.py``, the driver's provisional
commit, the watcher's export) against a throwaway repo. Those call ``git commit`` without
setting ``user.name``/``user.email`` — correctly, because in production the operator's own git
config supplies them.

On a developer workstation that always works even with no config file, because git falls back
to an identity derived from the SYSTEM ACCOUNT (the gecos full name plus ``user@hostname``).
A CI runner has no gecos name, so the same code fails there with::

    Author identity unknown
    *** Please tell me who you are.

That asymmetry is why these files were originally excluded from CI collection, and why an
attempt to verify them locally by emptying ``GIT_CONFIG_GLOBAL``/``GIT_CONFIG_SYSTEM`` was
unsound: it removed the config files but not the account fallback, so the suite passed locally
and still failed in CI. Measured: ``git var GIT_AUTHOR_IDENT`` with both config paths sent to
``/dev/null`` still returned a full identity from the account.

Setting the identity through the ENVIRONMENT fixes it for every subprocess without touching
any repository's config, and mirrors what several tests in this directory already do inline
(``test_suite_scope.py``, ``test_dogfood_learnings_publish.py``). ``autouse`` and function-scoped: a
test that shells out to git cannot forget it, and the identity is undone with the test, so a
later suite on the same xdist worker never inherits it. Deliberately NOT a real address, so a commit
that escaped a temporary directory would be obvious in a log.

## Why the data home is redirected here

``store.data_dir()`` resolves to the OPERATOR's live app directory, so a test that writes
``store.config_path()`` without redirecting it replaces the repository the app is configured
against. ``write_json_atomic`` REPLACES the document rather than merging, so the live
``target_url``/``target_display`` are dropped and ``clone`` is left naming a pytest temporary
directory that is reaped when the session ends. The app's page then renders with no repository,
and calibration refuses because the configured clone does not exist.

Nothing in the suite fails when that happens — the damage lands outside the assertions — so the
redirect is ``autouse``: a per-file opt-in fixture only protects the files that remember to ask
for it. Several files here already define their own ``data_home`` fixture; those still work,
because a function-scoped ``monkeypatch.setattr`` on the same attribute simply wins over this
one.
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

TESTS = Path(__file__).resolve().parent
if str(TESTS) not in sys.path:
    # The helper modules beside the tests (``ai_spine_driver_coverage_helpers``) are
    # imported by name, as Kiro Crew's own test tree imports its helpers.
    sys.path.insert(0, str(TESTS))

# Kiro Crew (a pinned test dependency, ``tests/requirements.txt``) is the host the
# app resolves through ``backend/_host.py``. Its data home is pinned to a throwaway
# directory BEFORE anything imports it, and again per test (below), so no test reads
# or writes the operator's real ``~/.kiro/crew``.
_SESSION_HOME = Path(tempfile.mkdtemp(prefix="kca-auto-improvement-home-"))
os.environ["KIROCREW_HOME"] = str(_SESSION_HOME / "crew")
os.environ["KIROCREW_WORKSPACE"] = str(_SESSION_HOME / "workspace")
os.environ["AUTO_IMPROVEMENT_SCRATCH"] = str(_SESSION_HOME / "scratch")

from auto_improvement.backend import _host, clone_setup, store  # noqa: E402

#: ``store.data_dir`` as the app ships it, captured before any fixture replaces it.
_SHIPPED_DATA_DIR = store.data_dir


def pytest_unconfigure(config: pytest.Config) -> None:
    shutil.rmtree(_SESSION_HOME, ignore_errors=True)


def _listed(name: str) -> set[str]:
    """The node ids in ``tests/<name>``, comments and blank lines dropped."""
    lines = (TESTS / name).read_text(encoding="utf-8").splitlines()
    return {line.strip() for line in lines if line.strip() and not line.startswith("#")}


def _can_create_symlink() -> bool:
    with tempfile.TemporaryDirectory() as tmp:
        target = os.path.join(tmp, "target")
        os.mkdir(target)
        try:
            os.symlink(target, os.path.join(tmp, "link"))
        except (OSError, NotImplementedError, AttributeError):
            return False
        return True


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Apply the two inventories Kiro Crew's rootdir conftest applied to these tests.

    ``windows-expected-failures.txt``: a strict xfail on Windows. ``requires-real-symlinks.txt``:
    a skip on a host that cannot create a symlink. An entry without ``[params]`` covers
    every parametrization of its test.
    """
    windows = sys.platform == "win32"
    expected = _listed("windows-expected-failures.txt") if windows else set()
    needs_links = set() if _can_create_symlink() else _listed("requires-real-symlinks.txt")
    for item in items:
        node = item.nodeid.split("@", 1)[0]
        bare = node.split("[", 1)[0]
        if node in expected or bare in expected:
            item.add_marker(
                pytest.mark.xfail(strict=True, reason="known Windows gap (windows-expected-failures.txt)")
            )
        if node in needs_links or bare in needs_links:
            item.add_marker(
                pytest.mark.skip(
                    reason="creating a symlink needs SeCreateSymbolicLinkPrivilege on Windows"
                )
            )


#: Git reads these before falling back to config files or the system account, so they make the
#: identity explicit and hermetic on every host.
_GIT_IDENTITY = {
    "GIT_AUTHOR_NAME": "auto-improvement tests",
    "GIT_AUTHOR_EMAIL": "tests@auto-improvement.invalid",
    "GIT_COMMITTER_NAME": "auto-improvement tests",
    "GIT_COMMITTER_EMAIL": "tests@auto-improvement.invalid",
}


@pytest.fixture
def _floor_monkeypatch() -> Iterator[pytest.MonkeyPatch]:
    """The isolation floor's OWN ``MonkeyPatch``, never the shared ``monkeypatch``.

    The same fixture Kiro Crew's rootdir conftest gives its suite, under the same
    name, because tests ported from it ask for it. The floor fixtures below patch
    through this instance, so a test that calls ``monkeypatch.undo()`` part-way to
    drop one of its own patches does not also drop the data-home pin. It is the
    first fixture every test sets up (each autouse floor fixture asks for it), so
    it is torn down LAST: a test's own ``monkeypatch`` of a name the floor also
    patched is undone first, back to the floor's value, which the floor then
    restores to the original.
    """
    mp = pytest.MonkeyPatch()
    try:
        yield mp
    finally:
        mp.undo()


@pytest.fixture(autouse=True, scope="session")
def _git_global_config(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Path]:
    """Turn git's auto maintenance off before any session, module or class fixture runs.

    The git floor Kiro Crew's rootdir conftest gives its suite (``conftest_floor_git``),
    restated for this one. A commit with auto maintenance on leaves a detached
    ``git maintenance run --auto`` adding and removing lock files in the repository, so
    a test that copies a worktree right after committing could list a file that is
    gone by the time it is read.

    ``GIT_CONFIG_GLOBAL`` points at a file that includes the global config git would
    read anyway, then turns auto maintenance off, so it also reaches git that code
    under test runs with an env of its own built over ``os.environ``. The location
    variables a git hook exports (``GIT_DIR``, ``GIT_INDEX_FILE``, ...) are removed,
    so a suite run from a hook cannot point a fixture repo's ``git commit`` at the
    developer's real repository.
    """
    from git_maintenance_helpers import git_global_config_text, git_maintenance_off_entries

    directory = tmp_path_factory.mktemp("git-global")
    inherited = os.environ.get("GIT_CONFIG_GLOBAL")
    if inherited is None:
        xdg = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
        includes = [(xdg / "git" / "config").as_posix(), "~/.gitconfig"]
    elif inherited and inherited != os.devnull:
        includes = [Path(inherited).absolute().as_posix()]
    else:
        includes = []
    inherit = directory / "inherit.gitconfig"
    inherit.write_text(git_global_config_text(includes), encoding="utf-8")
    hermetic = directory / "hermetic.gitconfig"
    hermetic.write_text(git_global_config_text(), encoding="utf-8")
    patch = pytest.MonkeyPatch()
    try:
        patch.setenv("GIT_CONFIG_GLOBAL", str(inherit))
        for name, value in git_maintenance_off_entries(os.environ).items():
            patch.setenv(name, value)
        for name in _git_vars_to_strip():
            patch.delenv(name, raising=False)
        yield hermetic
    finally:
        patch.undo()


def _git_vars_to_strip() -> frozenset[str]:
    """The git location variables removed from every test's environment.

    The host's own list (what ``update_governance`` strips before it runs git against a
    discovered checkout), less ``GIT_CEILING_DIRECTORIES``, plus ``GIT_CONFIG_PARAMETERS``
    (a hook started by ``git -c key=value`` exports the caller's settings there, and git
    reads them after ``GIT_CONFIG_COUNT``).
    """
    from kiro_crew.platform.update_governance import _GIT_LOCATION_VARS

    return (_GIT_LOCATION_VARS - {"GIT_CEILING_DIRECTORIES"}) | {"GIT_CONFIG_PARAMETERS"}


@pytest.fixture(autouse=True)
def _git_floor(_floor_monkeypatch: pytest.MonkeyPatch, _git_global_config: Path) -> None:
    """Re-apply the git floor for a test whose environment lost part of it."""
    from git_maintenance_helpers import git_maintenance_off_entries

    for name in _git_vars_to_strip():
        _floor_monkeypatch.delenv(name, raising=False)
    for name, value in git_maintenance_off_entries(os.environ).items():
        _floor_monkeypatch.setenv(name, value)


@pytest.fixture(autouse=True)
def _git_identity_for_production_commit_paths(
    _floor_monkeypatch: pytest.MonkeyPatch,
) -> Iterator[None]:
    """Provide missing git identity fields only for the current test.

    Git subprocesses inherit these fields, so a longer-lived patch would give
    unrelated tests on the same worker an identity they did not request.
    Explicitly exported values are left unchanged.
    """
    for key, value in _GIT_IDENTITY.items():
        if key not in os.environ:
            _floor_monkeypatch.setenv(key, value)
    yield


@pytest.fixture(autouse=True)
def _hermetic_git_config(_floor_monkeypatch: pytest.MonkeyPatch, _git_global_config: Path) -> None:
    """Keep the host's global git config out of this suite's git.

    The session floor's global file includes the host's ``~/.gitconfig``, so a host
    ``core.hooksPath`` whose ``pre-commit`` refuses a commit on ``main`` failed every
    fixture commit here. System config stays: Windows runners need its ``core.autocrlf``.
    """
    _floor_monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(_git_global_config))


@pytest.fixture(autouse=True)
def _isolated_kirocrew_home(tmp_path: Path, _floor_monkeypatch: pytest.MonkeyPatch) -> Path:
    """Pin the host's data home under this test's ``tmp_path``, whatever else runs.

    Kiro Crew's rootdir conftest does this for its own suite. It is a fixture of its
    own, not part of :func:`_isolated_app_data_home`, because several test files
    define a fixture of that name to move only the app's data root, and an override
    must not also drop the home pin.
    """
    home = tmp_path / "kirocrew-home"
    home.mkdir(parents=True, exist_ok=True)
    _floor_monkeypatch.setenv("KIROCREW_HOME", str(home))
    _floor_monkeypatch.setenv("KIROCREW_WORKSPACE", str(tmp_path / "kirocrew-workspace"))
    _floor_monkeypatch.setenv("AUTO_IMPROVEMENT_SCRATCH", str(tmp_path / "app-scratch"))
    return home


@pytest.fixture(autouse=True)
def _isolated_app_data_home(
    tmp_path: Path, _floor_monkeypatch: pytest.MonkeyPatch, _isolated_kirocrew_home: Path
) -> Path:
    """Point the app's data root and clone scratch at this test's temp directory.

    Only ``data_dir`` is redirected, not ``workspace_dir``: every other path in
    :mod:`..backend.store` derives from it, so one seam covers config, the per-repo
    subtree, sessions and logs. Files that additionally want ``workspace_dir ==
    data_dir`` (so flat fixture paths and the per-repo layout coincide) keep pinning
    it themselves.

    ``AUTO_IMPROVEMENT_SCRATCH`` moves clones out of ``~/.autoimprove-scratch`` for the
    same reason: a test that clones into the real scratch root leaves a tree the app
    then refuses to reuse, because setup compares the requested URL against the
    push-neutralized origin the app itself wrote.

    ``KIROCREW_HOME`` (pinned by :func:`_isolated_kirocrew_home`, which this asks for)
    is the outer fence, and it is the one that matters most. Patching
    ``data_dir`` only redirects callers that go through :mod:`..backend.store`, while
    ``do_not_pollute_paths`` reaches the operator's home directly through
    ``config.loader.config_dir()`` — and that resolver is not a read: on the default
    path it migrates a legacy home, writes a recovery breadcrumb outside ``~/.kiro/``,
    and sweeps archive leftovers. Pointing the variable at a temp directory redirects
    every reader of the home, including the ones no fixture knows about.

    This is STRICTER than the rootdir conftest's own per-test pin, and the difference is what
    it is here for: the home lands under THIS test's ``tmp_path``, beside the app's own data
    dir, so the two coincide and a fixture path is coherent across both.
    ``test_data_home_isolation.py::test_the_config_home_resolver_is_the_tests_temp_dir``
    fails without it — the rootdir home is under its own isolation root, a tmp dir but not
    this one.
    """
    data = tmp_path / "app-data-home"
    data.mkdir(parents=True, exist_ok=True)
    _floor_monkeypatch.setattr(store, "data_dir", lambda: data)
    return data


@pytest.fixture(autouse=True)
def bound_ctx(
    tmp_path: Path, _isolated_kirocrew_home: Path, _floor_monkeypatch: pytest.MonkeyPatch
) -> Iterator[object]:
    """The context the gateway hands the hooks, bound for every test.

    The host's own ``AppContext`` (so ``ctx.require_owner`` is the gateway's owner
    gate and ``ctx.sdk_level`` its level), naming the test's app data directory. A
    test that models a gateway without a seam replaces it.
    """
    from kiro_crew.apps.context import AppContext

    data = tmp_path / "app-data-home"
    data.mkdir(parents=True, exist_ok=True)
    ctx = AppContext(name=store.APP_NAME, data_dir=data)
    # What one test found missing from the host (a test models a stripped gateway) is
    # that test's own record, not the next one's capability report.
    _floor_monkeypatch.setattr(_host, "_missing", set())
    _host.bind(ctx)
    yield ctx
    _host.unbind()


@pytest.fixture
def shipped_data_home(bound_ctx: object, _floor_monkeypatch: pytest.MonkeyPatch) -> Path:
    """The production data layout: ``store.data_dir()`` is the shipped function again,
    reading ``ctx.data_dir``, and the bound context names the directory the gateway
    hands the app, ``<data home>/apps/auto-improvement/data``.

    For a test about where files land, rather than about what is in them.
    """
    from kiro_crew.config.paths import config_dir

    data = Path(config_dir()) / "apps" / store.APP_NAME / "data"
    _floor_monkeypatch.setattr(bound_ctx, "data_dir", data)
    _floor_monkeypatch.setattr(store, "data_dir", _SHIPPED_DATA_DIR)
    return data


@pytest.fixture
def _public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Resolve every hostname to a fixed public address, and pin ``gh`` to https.

    ``resolve_origin_url`` re-runs ``validate_target_url``, whose ``_host_is_blocked``
    SSRF check does a LIVE ``socket.getaddrinfo`` resolve and fails CLOSED on any
    resolver error. On a transient runner DNS hiccup ``github.com`` reads as blocked
    and a legitimate remote resolves to ``""`` — flaking the legitimate-remote
    assertions and letting the refusal assertions pass for the WRONG reason (the
    resolver-error path instead of the allowlist/identity path they exist to pin).
    Tests that request this fixture are about URL/identity validation, not address
    screening, so resolution is stubbed — the same shape as the ``public_dns``
    fixture in ``test/test_meetings_providers.py``. The address decision itself
    keeps its own live coverage elsewhere; the production fail-closed behaviour is
    deliberately untouched (it is correct for a real DNS failure — the defect was a
    unit test exercising the real resolver).

    ``_gh_prefers_ssh`` is pinned on the same seam: ``validate_target_url`` shells
    out to ``gh config get git_protocol`` / ``git config`` (timeout=15 each) to pick
    a clone transport, which is a host-configuration dependency a unit test must not
    read. Pinned to https so the rebuilt clone url has one deterministic shape.

    Deliberately NAMED, never autouse: the patch swaps the shared ``socket``
    module's ``getaddrinfo`` for the whole process while a test runs
    (``clone_setup.socket`` IS that module; monkeypatch restores it at teardown).
    Tests that do other network I/O must not inherit it silently.
    """
    monkeypatch.setattr(
        clone_setup.socket,
        "getaddrinfo",
        lambda *_a, **_kw: [(2, 1, 6, "", ("93.184.216.34", 443))],
    )
    monkeypatch.setattr(clone_setup, "_gh_prefers_ssh", lambda: False)
