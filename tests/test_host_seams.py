"""Every place the app reaches the gateway, and what it does when the gateway lacks it.

* ``_host.need`` binds the gateway's own object when it has one; otherwise a stand-in
  that REFUSES every use (and is falsy), a pure constant's host literal, or an
  exception class an ``except`` clause can still name. ``_host.require`` (a call-time
  lookup) raises ``HostCapabilityMissing``, an ``ImportError``, as the built-in's
  failed import did. Every missing name is reported through ``ctx.health``.
* ``ctx.require_owner`` is the owner gate; without it every caller is refused.
* ``ctx.data_dir`` is where the app's data lives, created owner-only.
* The hooks the manifest names bind the context, attach the gateway's session
  runtime from ``ctx.http_app``, and stand both workers down.
* The stdio MCP server starts from ``backend/mcp_launch.py`` in a fresh interpreter.
"""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from aiohttp import web
from aiohttp.test_utils import make_mocked_request

from auto_improvement.backend import _host, crew, hooks, pr_watchers, routes, runner, store

APP_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def no_host(monkeypatch: pytest.MonkeyPatch) -> None:
    """A gateway that provides nothing, with a clean record of what was missing."""
    monkeypatch.setattr(_host, "_host_attr", lambda module, name: None)
    monkeypatch.setattr(_host, "_host_module", lambda module: None)
    monkeypatch.setattr(_host, "_missing", set())


class TestResolution:
    def test_a_provided_name_is_the_gateways_own_object(self) -> None:
        from kiro_crew.security import redact

        assert _host.need("security", "redact") is redact
        assert _host.require("security", "redact") is redact

    def test_a_submodule_named_from_its_package_resolves(self) -> None:
        import kiro_crew.apps.teardown as teardown

        assert _host.need("apps", "teardown") is teardown

    def test_a_missing_name_is_a_stand_in_that_refuses_every_use(self, no_host: None) -> None:
        sandboxed = _host.need("sandbox", "sandboxed_spawn_argv")
        assert not sandboxed
        with pytest.raises(
            _host.HostCapabilityMissing, match="kiro_crew.sandbox.sandboxed_spawn_argv"
        ):
            sandboxed(["git", "status"])
        with pytest.raises(_host.HostCapabilityMissing):
            sandboxed.some_attribute  # noqa: B018
        with pytest.raises(_host.HostCapabilityMissing):
            list(sandboxed)
        with pytest.raises(_host.HostCapabilityMissing):
            with sandboxed:
                pass
        assert _host.missing_names() == ["kiro_crew.sandbox.sandboxed_spawn_argv"]

    def test_a_refusal_is_an_import_error_so_an_import_guard_still_catches_it(
        self, no_host: None
    ) -> None:
        with pytest.raises(ImportError):
            _host.need("security", "redact")("text")
        with pytest.raises(ImportError, match="kiro_crew.security.redact"):
            _host.require("security", "redact")
        with pytest.raises(ImportError):
            _host.require_module("acp")
        assert not _host.need_module("platform_compat")

    def test_a_pure_constant_falls_back_to_the_hosts_literal(self, no_host: None) -> None:
        assert _host.need("subprocess_utf8", "UTF8_TEXT") == {
            "text": True,
            "encoding": "utf-8",
            "errors": "replace",
        }
        assert _host.need("hooks", "TOOL_DENY") == "deny"
        assert _host.require("acp.types", "EVENT_COMPLETE") == "complete"

    def test_every_literal_fallback_is_the_hosts_current_value(self) -> None:
        """The fallbacks restate the pinned host; a host that changed one fails here."""
        import importlib

        for key, literal in _host._LITERALS.items():
            module, _, name = key.rpartition(".")
            with pytest.MonkeyPatch.context():
                assert getattr(importlib.import_module(f"kiro_crew.{module}"), name) == literal, key

    def test_a_missing_exception_class_can_still_be_caught(self, no_host: None) -> None:
        error = _host.need("git_config_hooks", "ConfigHookScanError")
        assert issubclass(error, _host.HostCapabilityMissing)
        try:
            raise error("probe")
        except error:
            pass


class TestCapabilityReport:
    def test_a_level_1_gateway_with_everything_reports_nothing(self, bound_ctx: Any) -> None:
        bound_ctx.http_app = web.Application()
        assert _host.capability_issues(bound_ctx) == []

    def test_each_missing_seam_is_named(self, no_host: None) -> None:
        old = SimpleNamespace(sdk_level=0)
        issues = _host.capability_issues(old)
        assert any("App Kit level 0" in i for i in issues)
        assert any("ctx.http_app" in i for i in issues)
        no_gate = SimpleNamespace(sdk_level=1, http_app=object())
        assert _host.capability_issues(no_gate) == [
            "no ctx.require_owner: every owner-only action is refused"
        ]
        _host.need("sandbox", "run_limited")
        assert any("kiro_crew.sandbox.run_limited" in i for i in _host.capability_issues(no_gate))

    def test_register_routes_reports_the_issues_through_health(self, bound_ctx: Any) -> None:
        bound_ctx.http_app = None
        records = routes.register_routes(bound_ctx)
        assert records
        assert bound_ctx.health.status == "degraded"
        assert any("ctx.http_app" in issue for issue in bound_ctx.health.issues)

    def test_sdk_level_reads_only_an_int(self) -> None:
        assert _host.sdk_level(SimpleNamespace(sdk_level=True)) == 0
        assert _host.sdk_level(SimpleNamespace()) == 0
        assert _host.sdk_level(SimpleNamespace(sdk_level=1)) == 1


class TestOwnerGate:
    @pytest.mark.asyncio
    async def test_no_owner_seam_refuses_everyone(self) -> None:
        request = make_mocked_request("POST", "/api/apps/auto-improvement/run")
        refused = await _host.require_owner(SimpleNamespace(), request, "run_start")
        assert refused.status == 403
        assert json.loads(refused.body)["code"] == "owner_only"

    @pytest.mark.asyncio
    async def test_the_seam_receives_the_bare_operation(self) -> None:
        seen: list[str] = []

        async def gate(_request: Any, operation: str) -> None:
            seen.append(operation)

        ctx = SimpleNamespace(require_owner=gate)
        request = make_mocked_request("POST", "/api/apps/auto-improvement/run")
        assert await _host.require_owner(ctx, request, "run_start") is None
        assert seen == ["run_start"]

    def test_every_owner_gated_route_names_its_operation_bare(self) -> None:
        source = (APP_ROOT / "backend" / "routes.py").read_text(encoding="utf-8")
        assert "require_owner_dashboard_request" not in source
        assert (
            "auto_improvement." not in source.split("def _require_owner", 1)[1].split("\n\n\n")[0]
        )


class TestDataDirectory:
    def test_the_bound_context_names_the_data_root(self, shipped_data_home: Path) -> None:
        assert store.data_dir() == shipped_data_home
        assert shipped_data_home.is_dir()

    @pytest.mark.skipif(os.name != "posix", reason="POSIX mode bits")
    def test_a_recreated_data_root_is_owner_only(self, shipped_data_home: Path) -> None:
        store.data_dir()
        for path in (shipped_data_home, shipped_data_home.parent):
            assert stat.S_IMODE(path.stat().st_mode) == 0o700, path

    def test_without_a_context_it_is_the_gateways_app_data_dir(
        self, shipped_data_home: Path
    ) -> None:
        """The stdio MCP server has no context; the same directory comes from the host."""
        _host.unbind()
        assert store.data_dir() == shipped_data_home


class TestHooks:
    @pytest.mark.asyncio
    async def test_startup_binds_the_context_and_attaches_the_session_runtime(
        self, bound_ctx: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app = web.Application()
        state = SimpleNamespace(sessions=object(), context_builder=object())
        app["state"] = state
        bound_ctx.http_app = app
        started: list[Any] = []

        async def _crew_startup(ctx: Any) -> None:
            started.append(ctx)

        monkeypatch.setattr(crew, "on_startup", _crew_startup)
        monkeypatch.setattr(crew, "_runtime", None)
        monkeypatch.setattr(pr_watchers, "attach_loop", lambda loop: None)
        _host.unbind()
        await hooks.on_startup(bound_ctx)
        assert _host.bound() is bound_ctx
        assert crew._runtime is not None and crew._runtime.sessions is state.sessions
        assert started == [bound_ctx]

    @pytest.mark.asyncio
    async def test_startup_without_the_application_attaches_no_runtime(
        self, bound_ctx: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _crew_startup(ctx: Any) -> None:
            return None

        monkeypatch.setattr(crew, "on_startup", _crew_startup)
        monkeypatch.setattr(crew, "_runtime", None)
        monkeypatch.setattr(pr_watchers, "attach_loop", lambda loop: None)
        bound_ctx.http_app = None
        await hooks.on_startup(bound_ctx)
        assert crew._runtime is None
        with pytest.raises(RuntimeError, match="member session runtime"):
            crew.build_runner(stop_check=lambda: False, on_activity=lambda _e: None)

    @pytest.mark.asyncio
    async def test_shutdown_stops_both_workers(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls: list[str] = []
        registry = SimpleNamespace(stop_all=lambda: calls.append("watchers"))
        supervisor = SimpleNamespace(stop=lambda: calls.append("run") or {})
        monkeypatch.setattr(pr_watchers, "get_registry", lambda: registry)
        monkeypatch.setattr(runner, "get_supervisor", lambda: supervisor)
        await hooks.on_shutdown(None)
        assert calls == ["watchers", "run"]

    def test_the_hook_entry_holds_no_state(self) -> None:
        """The gateway executes a hook entry file once per hook; shared state lives elsewhere."""
        import ast

        tree = ast.parse((APP_ROOT / "backend" / "hooks.py").read_text(encoding="utf-8"))
        assigned = [
            target.id
            for node in tree.body
            if isinstance(node, ast.Assign)
            for target in node.targets
            if isinstance(target, ast.Name)
        ]
        assert assigned == ["logger"]


class TestMcpLauncher:
    def test_the_stdio_server_answers_from_a_fresh_interpreter(self, tmp_path: Path) -> None:
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "get_status", "arguments": {}},
            },
        ]
        env = dict(os.environ, KIROCREW_HOME=str(tmp_path / "home"), PYTHONIOENCODING="utf-8")
        out = subprocess.run(
            [sys.executable, str(APP_ROOT / "backend" / "mcp_launch.py")],
            input="".join(json.dumps(r) + "\n" for r in requests),
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
            cwd=tmp_path,
            timeout=120,
        )
        assert out.returncode == 0, out.stderr[-2000:]
        replies = [json.loads(line) for line in out.stdout.splitlines() if line.strip()]
        assert [r["id"] for r in replies] == [1, 2, 3]
        assert replies[0]["result"]["serverInfo"]["name"] == "auto-improvement"
        names = {tool["name"] for tool in replies[1]["result"]["tools"]}
        manifest = json.loads((APP_ROOT / "app.json").read_text(encoding="utf-8"))
        assert names == set(manifest["mcpServers"]["auto-improvement"]["autoApprove"])
        status = json.loads(replies[2]["result"]["content"][0]["text"])
        assert status["status"] == "idle"

    def test_the_launcher_drops_its_own_directory_from_the_path(self) -> None:
        code = (
            "import runpy, sys\n"
            f"sys.argv = [{str(APP_ROOT / 'backend' / 'mcp_launch.py')!r}]\n"
            f"sys.path.insert(0, {str(APP_ROOT / 'backend')!r})\n"
            "ns = runpy.run_path(sys.argv[0], run_name='probe')\n"
            "ns['_register_app_package']()\n"
            f"print({str(APP_ROOT / 'backend')!r} in sys.path)\n"
        )
        out = subprocess.run(
            [sys.executable, "-c", code], capture_output=True, text=True, timeout=60
        )
        assert out.returncode == 0, out.stderr
        assert out.stdout.strip() == "False"
