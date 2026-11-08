"""Run-start admission through ``ctx.lifecycle`` (App Kit level 2), and its fallback.

A run must not start once a disable has passed the app's stop hook: the hook would
already have run, so nothing would stop the new run. Admission therefore reads the
app's switch under the app's lifecycle lock, which the disable holds across the
hook and the ``enabled`` write. On a level-2 gateway the app asks
``ctx.lifecycle.admit`` for that and never touches the gateway's private
``apps.manager`` names; on an older gateway it takes the same lock through those
names (``tests/test_ai_backend_routes_coverage.py::TestRunEngine`` drives that
path, since the hand-built test context has no lifecycle).
"""

from __future__ import annotations

from typing import Any, Callable

import pytest
from test_ai_backend_routes_coverage import FakeSupervisor, _json_of, _request

from auto_improvement.backend import _host, routes, runner


class _Admission:
    def __init__(self, admitted: bool, value: Any = None, timed_out: bool = False) -> None:
        self.admitted = admitted
        self.value = value
        self.timed_out = timed_out


class _FakeLifecycle:
    """``ctx.lifecycle``: runs the check only when it admits, as the host's does."""

    def __init__(self, *, enabled: bool = True, timed_out: bool = False) -> None:
        self.enabled = enabled
        self.timed_out = timed_out
        self.checks = 0

    async def admit(self, check: Callable[[], Any] | None = None, **_kw: Any) -> _Admission:
        if self.timed_out:
            return _Admission(False, timed_out=True)
        if not self.enabled:
            return _Admission(False)
        self.checks += 1
        return _Admission(True, check() if check is not None else None)


class _CountingSupervisor(FakeSupervisor):
    def __init__(self) -> None:
        super().__init__()
        self.admitted_at: list[int | None] = []

    def stop_seq(self) -> int:
        return 7

    def start(self, config: dict[str, Any], *, admitted_at: int | None = None) -> dict[str, Any]:
        self.admitted_at.append(admitted_at)
        return super().start(config, admitted_at=admitted_at)


def _refuse(*_a: Any, **_k: Any) -> Any:
    raise AssertionError("a level-2 gateway's admission must not use apps.manager")


@pytest.fixture
def supervisor(monkeypatch: pytest.MonkeyPatch) -> _CountingSupervisor:
    fake = _CountingSupervisor()
    monkeypatch.setattr(runner, "get_supervisor", lambda: fake)
    return fake


@pytest.fixture
def private_names_refuse(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(routes, "is_app_enabled", _refuse)
    monkeypatch.setattr(routes, "app_lifecycle_lock", _refuse)


@pytest.mark.asyncio
@pytest.mark.usefixtures("private_names_refuse")
class TestLevelTwoAdmission:
    async def test_an_admitted_start_carries_the_stop_count_read_under_the_lock(
        self, bound_ctx: Any, supervisor: _CountingSupervisor, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        lifecycle = _FakeLifecycle()
        monkeypatch.setattr(bound_ctx, "lifecycle", lifecycle)
        response = await routes._handle_run_start(_request("POST"))
        assert response.status == 200
        assert lifecycle.checks == 1
        assert supervisor.admitted_at == [7]

    async def test_a_disabled_app_is_refused_and_no_run_starts(
        self, bound_ctx: Any, supervisor: _CountingSupervisor, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(bound_ctx, "lifecycle", _FakeLifecycle(enabled=False))
        response = await routes._handle_run_start(_request("POST"))
        assert response.status == 403
        assert _json_of(response)["code"] == "app_disabled"
        assert "start" not in supervisor.calls

    async def test_a_timed_out_admission_is_a_retryable_409_and_no_run_starts(
        self, bound_ctx: Any, supervisor: _CountingSupervisor, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(bound_ctx, "lifecycle", _FakeLifecycle(timed_out=True))
        response = await routes._handle_run_start(_request("POST"))
        assert response.status == 409
        assert _json_of(response)["code"] == "app_busy"
        assert "start" not in supervisor.calls

    async def test_the_hosts_own_lifecycle_seam_refuses_an_app_with_no_install_record(
        self, bound_ctx: Any, supervisor: _CountingSupervisor, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The real ``AppLifecycleSDK``: the test data home has no install record, so
        the app reads as off and the check never runs."""
        from kiro_crew.apps.lifecycle_sdk import AppLifecycleSDK

        monkeypatch.setattr(bound_ctx, "lifecycle", AppLifecycleSDK("auto-improvement"))
        response = await routes._handle_run_start(_request("POST"))
        assert response.status == 403
        assert _json_of(response)["code"] == "app_disabled"
        assert "start" not in supervisor.calls


@pytest.mark.asyncio
class TestOlderGateway:
    async def test_no_lifecycle_and_no_private_lock_refuses_every_start(
        self, bound_ctx: Any, supervisor: _CountingSupervisor, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(bound_ctx, "lifecycle", None)
        monkeypatch.setattr(routes, "is_app_enabled", _host.Unavailable("apps.manager.x"))
        monkeypatch.setattr(routes, "app_lifecycle_lock", _host.Unavailable("apps.manager.y"))
        response = await routes._handle_run_start(_request("POST"))
        assert response.status == 403
        assert _json_of(response)["code"] == "app_disabled"
        assert "start" not in supervisor.calls

    def test_the_capability_report_names_a_gateway_that_cannot_admit(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from types import SimpleNamespace

        monkeypatch.setattr(_host, "_host_attr", lambda _m, _n: None)
        ctx = SimpleNamespace(sdk_level=1, require_owner=lambda *_a: None, http_app=object())
        assert any("no ctx.lifecycle" in issue for issue in _host.capability_issues(ctx))

    def test_a_level_two_gateway_reports_no_lifecycle_gap_even_without_the_private_names(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from types import SimpleNamespace

        monkeypatch.setattr(_host, "_host_attr", lambda _m, _n: None)
        ctx = SimpleNamespace(
            sdk_level=2,
            require_owner=lambda *_a: None,
            http_app=object(),
            lifecycle=_FakeLifecycle(),
        )
        assert not any("lifecycle" in issue for issue in _host.capability_issues(ctx))
        assert not any("apps.manager" in name for name in _host.missing_names())
