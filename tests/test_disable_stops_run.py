"""Disabling the app must stop an in-flight run, not just refuse its routes.

Gateway shutdown is covered by ``test_shutdown_stops_run``. Disabling the app is a
different path with the same exposure and none of the same wiring: ``on_cleanup``
fires only when the gateway stops, so switching the app off leaves
``_require_enabled`` answering 403 on every route while the supervisor thread keeps
the clone lock and keeps spending budget. The operator sees the app off; the work
carries on.

The built-in reached that seam through ``apps.teardown.register_app_disable_hook``.
An installed app is told through its ``on_shutdown`` hook, which the gateway's
disable request runs INSIDE the request and before the ``enabled`` flag is
written (``teardown_app_runtime``), which is what makes it an off-switch rather
than a sweep: a worker holding something time-bounded can otherwise act once more
in the gap between the operator's click and the next poll.

These tests start a run that parks in ``driver.run`` so the supervisor genuinely
owns a live thread, then call ``backend.hooks.on_shutdown`` exactly as the disable
request does.
"""

from __future__ import annotations

import threading
from typing import Any

import pytest

from auto_improvement.backend import hooks, pr_watchers
from auto_improvement.backend import runner


class _BlockingDriver:
    """Parks in ``run`` until stopped, so the supervisor has a genuinely live thread."""

    def __init__(self) -> None:
        self._release = threading.Event()

    def run(self, **_kw: Any) -> Any:
        self._release.wait(timeout=10.0)
        return _FakeStats()

    def request_stop(self) -> None:
        self._release.set()


class _FakeStats:
    cycles = 0
    discovered = 0
    deduped = 0
    gated_out = 0
    not_kept = 0
    kept = 0
    filed = 0
    errors = 0
    cost_usd = 0.0


@pytest.fixture
def _fresh_singleton(monkeypatch: pytest.MonkeyPatch) -> runner.RunSupervisor:
    """A fresh process-wide supervisor for the duration of the test.

    The hook resolves the supervisor through ``runner.get_supervisor()``, so the test
    must drive that same singleton — but a run leaked into the real module singleton
    would make unrelated tests' "already active" refusal fire.
    """
    sup = runner.RunSupervisor()
    monkeypatch.setattr(runner, "_SUPERVISOR", sup)
    return sup


@pytest.mark.asyncio
async def test_disabling_the_app_stops_an_active_run(
    _fresh_singleton: runner.RunSupervisor, monkeypatch: pytest.MonkeyPatch, bound_ctx: Any
) -> None:
    driver = _BlockingDriver()
    monkeypatch.setattr(_fresh_singleton, "_build_driver", lambda _cfg: driver)

    started = _fresh_singleton.start({"clone": "/does/not/matter"})
    try:
        assert started["status"] == runner.STATUS_RUNNING
        assert _fresh_singleton.status()["status"] == runner.STATUS_RUNNING

        # Exactly what the disable request does, at the point it does it.
        await hooks.on_shutdown(bound_ctx)

        # The load-bearing assertion: with no hook registered, `notify_app_disabled`
        # returns immediately having found nothing, `request_stop` is never called,
        # and the run keeps the clone lock and the budget.
        assert (
            driver._release.is_set()
        ), "disabling the app did not ask the driver to stop — the run kept going"
        # The released driver returns at once, so the join inside `stop` observes a
        # finished thread and the terminal status is STOPPED, not DONE: the run ended
        # because it was asked to, and must not read as a normal finish.
        # (STOPPING would be the honest answer only if a real measurement outran the
        # join timeout.)
        status = _fresh_singleton.status()
        assert (
            status["status"] == runner.STATUS_STOPPED
        ), "the run supervisor was not stopped when the app was disabled"
        assert not status["error"]
        assert status["finished_at"] > 0
        assert status["activity"][-1]["note"] == "run stopped"
    finally:
        driver.request_stop()
        _fresh_singleton.stop()


@pytest.mark.asyncio
async def test_disabling_while_idle_is_a_no_op(
    _fresh_singleton: runner.RunSupervisor, bound_ctx: Any
) -> None:
    """``stop`` is idempotent, and the disable path must stay safe to fire at any
    time — an operator may disable an app that is doing nothing, repeatedly."""
    await hooks.on_shutdown(bound_ctx)
    await hooks.on_shutdown(bound_ctx)

    assert _fresh_singleton.status()["status"] != runner.STATUS_RUNNING


@pytest.mark.asyncio
async def test_disabling_the_app_also_stops_the_pr_watchers(
    _fresh_singleton: runner.RunSupervisor, monkeypatch: pytest.MonkeyPatch, bound_ctx: Any
) -> None:
    """The run is not the only worker a disable has to reach.

    A watcher runs an agent turn inside a per-PR clone on a timer, so leaving it
    going after the operator switches the app off keeps acting on their
    repositories with a permission that was withdrawn — the same harm the run
    poses, by a different worker. Gateway shutdown already signals both
    (``_stop_watchers`` beside ``_stop_run``); disable must not stop only one.
    """
    stopped: list[bool] = []

    def record_stop_all() -> int:
        stopped.append(True)
        return 0

    monkeypatch.setattr(pr_watchers.get_registry(), "stop_all", record_stop_all)

    await hooks.on_shutdown(bound_ctx)

    assert stopped, "disabling the app left the PR watchers running"


@pytest.mark.asyncio
async def test_a_failing_watcher_stop_still_stops_the_run(
    _fresh_singleton: runner.RunSupervisor, monkeypatch: pytest.MonkeyPatch, bound_ctx: Any
) -> None:
    """The two signals are contained separately.

    ``on_cleanup`` gets that for free by holding two hooks, so a raising watcher
    stop cannot skip the run stop there. This hook is one function and has to
    reproduce it deliberately.
    """
    driver = _BlockingDriver()
    monkeypatch.setattr(_fresh_singleton, "_build_driver", lambda _cfg: driver)

    def boom() -> int:
        raise RuntimeError("registry exploded")

    monkeypatch.setattr(pr_watchers.get_registry(), "stop_all", boom)

    _fresh_singleton.start({"clone": "/does/not/matter"})
    try:
        await hooks.on_shutdown(bound_ctx)
        assert driver._release.is_set(), "a failing watcher stop swallowed the run stop"
    finally:
        driver.request_stop()
        _fresh_singleton.stop()


def test_the_manifest_names_the_shutdown_hook() -> None:
    """A structural guard: the disable path reaches the app only through the
    ``on_shutdown`` hook the manifest names, so an edit that drops it fails here
    instead of silently letting a disabled app keep running."""
    import json
    from pathlib import Path

    manifest = json.loads((Path(__file__).resolve().parents[1] / "app.json").read_text(encoding="utf-8"))
    assert manifest["backend"]["hooks"]["on_shutdown"] == "backend.hooks:on_shutdown"
    assert callable(hooks.on_shutdown)
