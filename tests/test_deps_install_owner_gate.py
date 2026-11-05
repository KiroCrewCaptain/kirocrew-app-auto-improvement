"""Owner gate on ``POST /api/apps/auto-improvement/deps/install``, which runs pip in
the gateway interpreter.

Ported from the auto-improvement cases of Kiro Crew's
``test/test_owner_gate_round10_misc.py``. An allow-listed channel user can hold a
dashboard token whose claims are ``app == ""`` with a non-owner subject; only the
dashboard owner may run the install, and an app token is refused, the app's own
included. The gate is ``ctx.require_owner`` (the host's own owner check), served
through the same route records the gateway's registry mounts (``tests/harness.py``).
The install itself is a stub that records whether it was reached.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from harness import mount

pytestmark = pytest.mark.asyncio

OWNER = "U0OWNER0000"
NON_OWNER = "U0NONOWNER"


def _client(app: web.Application, user: str, app_claim: str = "") -> TestClient:
    @web.middleware
    async def _identity(request: web.Request, handler: Any) -> web.StreamResponse:
        request["user"] = user
        request["app"] = app_claim
        return await handler(request)

    app.middlewares.insert(0, _identity)
    return TestClient(TestServer(app))


def _deps_app(monkeypatch: pytest.MonkeyPatch) -> tuple[web.Application, list]:
    from auto_improvement.backend import deps

    calls: list = []

    def _fake_install() -> dict:
        calls.append(True)
        return {"ok": True, "installed": ["ruff"]}

    monkeypatch.setattr(deps, "install_deps", _fake_install)

    app = web.Application()
    app["state"] = MagicMock(owner_id=OWNER)
    mount(app, lifecycle=False)
    return app, calls


async def test_deps_install_refuses_non_owner_dashboard_user(monkeypatch) -> None:
    app, calls = _deps_app(monkeypatch)
    async with _client(app, NON_OWNER) as client:
        resp = await client.post("/api/apps/auto-improvement/deps/install")
        status, body = resp.status, await resp.json()
    assert status == 403
    assert body["code"] == "owner_only"
    assert calls == []


async def test_deps_install_allows_owner(monkeypatch) -> None:
    app, calls = _deps_app(monkeypatch)
    async with _client(app, OWNER) as client:
        resp = await client.post("/api/apps/auto-improvement/deps/install")
        status = resp.status
    assert status == 200
    assert calls == [True]


async def test_deps_install_refuses_an_app_token(monkeypatch) -> None:
    """An app token is not the owner, even the app's own token."""
    app, calls = _deps_app(monkeypatch)
    async with _client(app, "app-subject", app_claim="auto-improvement") as client:
        resp = await client.post("/api/apps/auto-improvement/deps/install")
        status = resp.status
    assert status == 403
    assert calls == []


async def test_deps_install_refuses_everyone_without_the_owner_seam(monkeypatch) -> None:
    """A gateway whose context has no ``require_owner`` refuses the owner too."""
    from auto_improvement.backend import _host

    app, calls = _deps_app(monkeypatch)
    ctx = _host.bound()
    monkeypatch.setattr(ctx, "require_owner", None, raising=False)
    async with _client(app, OWNER) as client:
        resp = await client.post("/api/apps/auto-improvement/deps/install")
        status, body = resp.status, await resp.json()
    assert status == 403
    assert body["code"] == "owner_only"
    assert calls == []


def _record_offloads(monkeypatch: pytest.MonkeyPatch, module: Any) -> list[str]:
    """Record the name of every function a module hands to ``asyncio.to_thread``."""
    offloaded: list[str] = []
    real = module.asyncio.to_thread

    async def _to_thread(func: Any, /, *args: Any, **kwargs: Any) -> Any:
        offloaded.append(func.__name__)
        return await real(func, *args, **kwargs)

    monkeypatch.setattr(module.asyncio, "to_thread", _to_thread)
    return offloaded


async def test_deps_install_audits_the_allowed_install(monkeypatch) -> None:
    import kiro_crew.sel as sel_mod

    from auto_improvement.backend import routes

    app, calls = _deps_app(monkeypatch)
    audit = MagicMock()
    monkeypatch.setattr(sel_mod, "sel", lambda: audit)
    offloaded = _record_offloads(monkeypatch, routes)
    async with _client(app, OWNER) as client:
        resp = await client.post("/api/apps/auto-improvement/deps/install")
        status = resp.status
    assert status == 200
    assert calls == [True]
    allowed = [
        c.kwargs
        for c in audit.log_api_access.call_args_list
        if c.kwargs.get("operation") == "auto_improvement.deps_install"
    ]
    assert [(a["outcome"], a["caller"]) for a in allowed] == [("allowed", OWNER)]
    assert "_audit_deps_install_allowed_sync" in offloaded, "the audit must run off the event loop"
