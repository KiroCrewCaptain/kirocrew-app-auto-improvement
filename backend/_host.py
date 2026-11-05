"""Every place Auto-Improvement reaches into the Kiro Crew gateway, in one module.

An external app's Python runs inside the gateway process (its hooks) or as a
child the gateway starts with its own interpreter (the stdio MCP server). It
needs two kinds of host surface:

1. **The App Kit context** handed to its hooks (``ctx``): the data directory
   (``ctx.data_dir``), the owner gate (``ctx.require_owner``, App Kit level 1),
   the seam level (``ctx.sdk_level``), health reporting (``ctx.health``) and
   the gateway's aiohttp application (``ctx.http_app``, granted because the
   manifest declares routes). These are public seams. Each is read off the
   context with ``getattr`` and has a fallback that is never MORE permissive
   than the host: no owner gate refuses every caller, the owner included.

2. **Gateway services with no App Kit seam yet.** The run creates persistent
   crew members and drives their sessions, spawns every agent and every
   repository command inside the gateway's OS sandbox, gates each tool call
   through the gateway's own hook manager and transport floor, redacts through
   the active platform context, and writes owner-only files the way the data
   home requires. None of that has a public seam, so each name is resolved from
   the running gateway here, by name, through :func:`_host_attr`
   (``importlib``). ``PORTING.md`` lists every one with its call sites and the
   generic seam that would replace it.

   :func:`need` resolves a name when the importing module binds it, exactly
   where the built-in bound it with ``from kiro_crew.<module> import <name>``,
   so a test that patches the binding on the app's module still reaches it.
   When the gateway does not provide the name, :func:`need` returns a stand-in
   that REFUSES: calling it, reading an attribute off it, iterating it or
   entering it raises :class:`HostCapabilityMissing`, so the operation that
   needed it stops instead of running some other way (a missing sandbox never
   becomes an unsandboxed spawn, a missing redactor never becomes unredacted
   text). An exception class falls back to a fresh subclass of
   :class:`HostCapabilityMissing`, so an ``except`` clause naming it still
   works; a pure literal constant (an event name, a decision code, the UTF-8
   subprocess keywords) falls back to the host's current literal, which carries
   no policy. :func:`capability_issues` names every missing one, and
   ``register_routes`` reports them through ``ctx.health``.

Nothing else in this app names ``kiro_crew`` (``tests/test_no_host_imports.py``
pins that), and this module has no ``import kiro_crew`` statement: every host
name goes through :func:`_host_attr`, so a missing one never breaks the load.
"""

from __future__ import annotations

import importlib
import logging
import signal
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Awaitable, Callable

logger = logging.getLogger("kirocrew.app.auto-improvement")

APP_NAME = "auto-improvement"

#: The App Kit seam level this app is written against: structural route records
#: and ``ctx.require_owner``.
REQUIRED_SDK_LEVEL = 1

#: The gateway's top-level package. Held here, the one module allowed to name it.
_HOST_PACKAGE = "kiro_crew"


# ── host resolution ─────────────────────────────────────────────────────────


def _host_attr(module: str, name: str) -> Any | None:
    """``module.name`` from the running gateway, or ``None`` when it has none.

    The one seam tests replace to model an older or stripped-down gateway.
    """
    try:
        mod = importlib.import_module(module)
    except Exception:  # noqa: BLE001 - any import failure means "not provided"
        return None
    value = getattr(mod, name, None)
    if value is None and hasattr(mod, "__path__"):
        # ``from package import submodule``: a submodule is an attribute of its
        # package only once something imported it.
        value = _host_module(f"{module}.{name}")
    return value


def _host_module(module: str) -> Any | None:
    try:
        return importlib.import_module(module)
    except Exception:  # noqa: BLE001 - any import failure means "not provided"
        return None


def _qualify(module: str) -> str:
    return f"{_HOST_PACKAGE}.{module}" if module else _HOST_PACKAGE


class HostCapabilityMissing(ImportError):
    """The gateway does not provide a service this operation requires.

    An ``ImportError``, because it stands for the ``from kiro_crew.<module> import
    <name>`` that failed: a caller that guarded an import with ``except ImportError``
    (or ``except Exception``) keeps its fail-closed branch.
    """


_missing_lock = threading.Lock()
#: ``module.name`` of every host name a :func:`need` call could not resolve.
_missing: set[str] = set()


def _note_missing(qualified: str) -> None:
    with _missing_lock:
        first = qualified not in _missing
        _missing.add(qualified)
    if first:
        logger.warning("%s: the gateway does not provide %s", APP_NAME, qualified)


class Unavailable:
    """What :func:`need` binds for a host name the gateway does not provide.

    Every use refuses with :class:`HostCapabilityMissing`, and it is falsy, so a
    caller that feature-detects (``if name:``) reads it as absent.
    """

    __slots__ = ("_qualified",)

    def __init__(self, qualified: str) -> None:
        object.__setattr__(self, "_qualified", qualified)

    def _refuse(self, *_args: Any, **_kwargs: Any) -> Any:
        raise HostCapabilityMissing(
            f"the Kiro Crew gateway does not provide {self._qualified}, which "
            f"{APP_NAME} needs for this operation"
        )

    __call__ = _refuse
    __iter__ = _refuse
    __enter__ = _refuse
    __exit__ = _refuse
    __getitem__ = _refuse
    keys = _refuse

    def __getattr__(self, name: str) -> Any:
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        return self._refuse()

    def __bool__(self) -> bool:
        return False

    def __repr__(self) -> str:
        return f"<unavailable host name {self._qualified}>"


#: Pure constants the app reads from the gateway, with the host's current literal
#: as the fallback. Each is a name (an event kind, a decision code, a file-name
#: affix, a platform fact), never a policy, so a gateway that moved one still
#: runs with the value it had.
_LITERALS: dict[str, Any] = {
    "acp.types.EVENT_COMPLETE": "complete",
    "acp.types.EVENT_PERMISSION_REQUEST": "permission_request",
    "acp.types.EVENT_TEXT_CHUNK": "text_chunk",
    "acp.types.EVENT_TOOL_CALL": "tool_call",
    "acp.types.EVENT_TOOL_CALL_UPDATE": "tool_call_update",
    "acp.types.STOP_REASON_STALE_RECOVER": "stale_recover",
    "constants.DENY_CAUSE_AUDIT_UNAVAILABLE": "audit_unavailable",
    "constants.DENY_CAUSE_HOOK_ERROR": "hook_error",
    "constants.DENY_CAUSE_POLICY": "policy",
    "constants.DENY_CAUSE_SURFACE_POLICY": "surface_policy",
    "hooks.HOOK_REPLY": "reply",
    "hooks.TOOL_DENY": "deny",
    "member_workspace.AUTO_WORKSPACE": "",
    "permission_floor.OUTCOME_PENDING_APPROVAL": "approval_pending",
    "permission_floor.OUTCOME_REJECTED_TRANSPORT_FLOOR": "rejected_transport_floor",
    "platform_compat.IS_WINDOWS": sys.platform == "win32",
    "platform_compat.SIGKILL": getattr(signal, "SIGKILL", 9),
    "sandbox.LAUNCHER_EXIT_PREFIXES": (
        "sandbox: BLOCKED",
        "sandbox: FATAL",
        "sandbox: unshare(",
        "sandbox_launcher:",
    ),
    "sandbox._LAUNCHER_SCRIPT_SUFFIX": ".py",
    "sandbox._SANDBOX_ARTIFACT_PREFIX": "kirocrew_sandbox_",
    "subprocess_utf8.UTF8_TEXT": MappingProxyType(
        {"text": True, "encoding": "utf-8", "errors": "replace"}
    ),
}

#: Exception classes the app names in an ``except`` clause. Without the gateway's
#: own class the stand-in is a fresh :class:`HostCapabilityMissing` subclass, which
#: the code that would have raised it (also the gateway's) never raises.
_EXCEPTIONS = frozenset({"git_config_hooks.ConfigHookScanError"})


def need(module: str, name: str) -> Any:
    """The gateway's ``kiro_crew.<module>.<name>``, or a stand-in.

    The stand-in refuses every use (:class:`Unavailable`), except for the pure
    constants in :data:`_LITERALS` (the host's current literal) and the
    exception classes in :data:`_EXCEPTIONS` (a :class:`HostCapabilityMissing`
    subclass, so an ``except`` clause naming it still works).
    """
    key = f"{module}.{name}"
    qualified = f"{_qualify(module)}.{name}"
    value = _host_attr(_qualify(module), name)
    if value is not None:
        return value
    _note_missing(qualified)
    if key in _LITERALS:
        return _LITERALS[key]
    if key in _EXCEPTIONS:
        return type(name, (HostCapabilityMissing,), {"__module__": __name__})
    return Unavailable(qualified)


def require(module: str, name: str) -> Any:
    """The gateway's ``kiro_crew.<module>.<name>``; raise when it has none.

    For a name resolved at CALL time (the built-in's function-local imports): the
    caller's own ``try``/``except`` around the import is its fail-closed branch, so
    a missing name raises :class:`HostCapabilityMissing` there, as the failed
    import did. A pure constant still falls back to the host's literal.
    """
    key = f"{module}.{name}"
    qualified = f"{_qualify(module)}.{name}"
    value = _host_attr(_qualify(module), name)
    if value is not None:
        return value
    _note_missing(qualified)
    if key in _LITERALS:
        return _LITERALS[key]
    raise HostCapabilityMissing(
        f"the Kiro Crew gateway does not provide {qualified}, which {APP_NAME} needs "
        "for this operation"
    )


def need_module(module: str) -> Any:
    """The gateway module ``kiro_crew.<module>``, or a refusing stand-in."""
    qualified = _qualify(module)
    value = _host_module(qualified)
    if value is not None:
        return value
    _note_missing(qualified)
    return Unavailable(qualified)


def require_module(module: str) -> Any:
    """The gateway module ``kiro_crew.<module>``; raise when it has none (call time)."""
    qualified = _qualify(module)
    value = _host_module(qualified)
    if value is not None:
        return value
    _note_missing(qualified)
    raise HostCapabilityMissing(
        f"the Kiro Crew gateway does not provide {qualified}, which {APP_NAME} needs "
        "for this operation"
    )


def missing_names() -> list[str]:
    """Every host name a :func:`need` call could not resolve, sorted."""
    with _missing_lock:
        return sorted(_missing)


# ── route records ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Route:
    """One ``hooks.routes`` record, accepted structurally by the gateway.

    A level-1 ``RouteRegistry`` takes any record with a str ``method``, a str
    ``path`` (relative to ``/api/apps/auto-improvement``) and a callable
    ``handler(request, ctx)``.
    """

    method: str
    path: str
    handler: Callable[[Any, Any], Awaitable[Any]]


def sdk_level(ctx: Any) -> int:
    """The seam level the gateway reports; 0 for a gateway that predates the field."""
    level = getattr(ctx, "sdk_level", 0)
    return level if isinstance(level, int) and not isinstance(level, bool) else 0


# ── the bound app context ───────────────────────────────────────────────────

_ctx: Any | None = None
_ctx_lock = threading.Lock()


def bind(ctx: Any) -> None:
    """Remember the context the gateway handed to a hook.

    Run work reaches the context from places no request passes through (the
    supervisor's worker thread, the PR watchers), so it is held here. A later
    context replaces an earlier one: an update or a re-enable hands a fresh one.
    """
    global _ctx
    with _ctx_lock:
        _ctx = ctx


def unbind(ctx: Any | None = None) -> None:
    """Forget the bound context (only *ctx*, when given)."""
    global _ctx
    with _ctx_lock:
        if ctx is None or _ctx is ctx:
            _ctx = None


def bound() -> Any | None:
    with _ctx_lock:
        return _ctx


def bound_data_dir() -> Path | None:
    """``ctx.data_dir`` of the bound context, when there is one."""
    ctx = bound()
    raw = getattr(ctx, "data_dir", None) if ctx is not None else None
    return Path(raw) if raw else None


# ── public seams ────────────────────────────────────────────────────────────


def owner_denied_response() -> Any:
    from aiohttp import web

    return web.json_response(
        {"error": "owner authorization required", "code": "owner_only"}, status=403
    )


async def require_owner(ctx: Any, request: Any, operation: str) -> Any | None:
    """``None`` when the caller is the dashboard owner, else the refusal to return.

    *operation* is bare (``"run_start"``): the host prefixes the app's own name
    when it audits a denial. A gateway without the seam refuses everyone.
    """
    gate = getattr(ctx, "require_owner", None)
    if not callable(gate):
        return owner_denied_response()
    return await gate(request, operation)


def http_app(ctx: Any) -> Any | None:
    """The gateway's aiohttp application, when the context carries it."""
    return getattr(ctx, "http_app", None)


def dashboard_state(ctx: Any) -> Any | None:
    """The dashboard state the gateway keeps on its application, if any."""
    app = http_app(ctx)
    if app is None:
        return None
    try:
        return app.get("state")
    except Exception:  # noqa: BLE001 - an application that cannot be read has no state
        return None


def report_health(ctx: Any, issues: list[str]) -> None:
    """Mark the app degraded with *issues*; a context without health is skipped."""
    health = getattr(ctx, "health", None)
    mark = getattr(health, "mark_degraded", None)
    if not callable(mark):
        return
    for issue in issues:
        try:
            mark(issue)
        except Exception:  # noqa: BLE001 - reporting must never break registration
            logger.debug("%s: health report failed", APP_NAME, exc_info=True)


def capability_issues(ctx: Any) -> list[str]:
    """Why this gateway cannot run every part of the app, one sentence each."""
    issues: list[str] = []
    if sdk_level(ctx) < REQUIRED_SDK_LEVEL:
        issues.append(
            f"App Kit level {sdk_level(ctx)} is below {REQUIRED_SDK_LEVEL}: routes may not "
            "register and every owner-only action is refused"
        )
    elif not callable(getattr(ctx, "require_owner", None)):
        issues.append("no ctx.require_owner: every owner-only action is refused")
    if http_app(ctx) is None:
        issues.append(
            "no ctx.http_app: the run has no member session runtime and PR watchers "
            "cannot read live pull-request status"
        )
    for name in missing_names():
        issues.append(f"the gateway does not provide {name}; the operations that need it refuse")
    return issues
