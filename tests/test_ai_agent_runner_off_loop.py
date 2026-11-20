"""The runner's audited writes and governance gate stay off the event loop.

In a spawned app backend ``sel()`` is a route client: a critical write is network I/O and
is refused on a thread that runs an event loop. The runner awaits on that loop, so its
approval write and its governance gate (which can write a critical deny-exception row)
run on a worker thread. These tests pin that, and that a failure or a cancel on the way
never ends in an approval. The shared fakes are those of ``test_ai_agent_runner_coverage``.
"""

# flake8: noqa: F811  -- ``fake_sel`` is a fixture imported from the sibling suite
from __future__ import annotations

import asyncio
import sys

import pytest
from kiro_crew.acp.types import EVENT_COMPLETE, EVENT_PERMISSION_REQUEST
from test_ai_agent_runner_coverage import _drive, _ev, _FakeProvider, fake_sel  # noqa: F401

from auto_improvement.spine import agent_runner as R

#: ``s3_direction._s3_download_only`` reads no command on Windows (no POSIX shell reads it
#: there), so the deny stands and no exception is granted: the S3 cases are POSIX-only.
_NO_S3_EXEMPTION_ON_WINDOWS = pytest.mark.skipif(
    sys.platform == "win32",
    reason="the S3 download exemption is not read on Windows (no POSIX shell reads the command)",
)


# In a spawned app backend ``sel()`` is a route client: a critical write is network I/O
# and is refused on a thread that runs an event loop. The runner must therefore run
# every critical write, and the governance gate that can make one, on a worker thread.


class _LoopRefusingSel:
    """A route-client-shaped writer: a critical write on a running loop is refused."""

    def __init__(self) -> None:
        self.rows: list[tuple[str, bool]] = []

    @staticmethod
    def _refuse_on_a_loop() -> None:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return
        raise OSError("a critical audit write must not run on an event loop")

    def log_tool_invocation(self, **kw) -> None:
        if kw.get("critical"):
            self._refuse_on_a_loop()
        self.rows.append(("tool_invocation", bool(kw.get("critical"))))

    def log(self, event, critical: bool = False, **_kw) -> None:
        if critical or event.event_type == "deny_exception":
            self._refuse_on_a_loop()
        self.rows.append((event.event_type, True))


@pytest.fixture
def route_like_sel(monkeypatch):
    sel = _LoopRefusingSel()
    monkeypatch.setattr("kiro_crew.sel.sel", lambda: sel)
    # The deny gate reaches the log through ``SecurityEventLog()`` or ``sel()``, by host version.
    monkeypatch.setattr("kiro_crew.security.deny_gate.SecurityEventLog", lambda *a, **k: sel)
    monkeypatch.setattr("kiro_crew.security.deny_gate.sel", lambda: sel, raising=False)
    return sel


_S3_DOWNLOAD = "aws s3 cp --no-sign-request s3://public-bucket/input.json ./input.json"


def _s3_download_events():
    return [
        _ev(
            kind=EVENT_PERMISSION_REQUEST,
            tool_kind="bash",
            request_id="r1",
            raw_tool_params={"command": _S3_DOWNLOAD},
        ),
        _ev(kind=EVENT_COMPLETE),
    ]


@pytest.mark.asyncio
async def test_approve_writes_its_audit_row_off_the_event_loop(route_like_sel):
    provider = _FakeProvider()
    await R.SessionAgentRunner._approve(provider, "r1", tool="fsWrite")

    assert provider.approved == ["r1"] and provider.rejected == []
    assert ("tool_invocation", True) in route_like_sel.rows


@pytest.mark.asyncio
@_NO_S3_EXEMPTION_ON_WINDOWS
async def test_run_async_approves_an_s3_download_the_deny_exception_allows(
    route_like_sel,
):
    provider = _FakeProvider(_s3_download_events())
    res = await _drive(R.SessionAgentRunner(), provider)

    assert res.ok is True
    assert provider.approved == ["r1"] and provider.rejected == []
    assert ("deny_exception", True) in route_like_sel.rows  # the exception row landed


@pytest.mark.asyncio
@_NO_S3_EXEMPTION_ON_WINDOWS
async def test_run_async_denies_when_the_deny_exception_is_written_on_the_loop(
    route_like_sel, monkeypatch
):
    """A missed offload fails closed: the write is refused on the loop, so the tool is denied."""

    async def _inline(func, /, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(R.asyncio, "to_thread", _inline)
    provider = _FakeProvider(_s3_download_events())
    res = await _drive(R.SessionAgentRunner(), provider)

    assert res.ok is True
    assert provider.approved == [] and provider.rejected == ["r1"]
    assert ("deny_exception", True) not in route_like_sel.rows


@pytest.mark.asyncio
async def test_run_async_denies_when_the_governance_call_itself_raises(monkeypatch, fake_sel):
    """A failure of the offloaded call (not a hook verdict) is a deny, never an approval."""

    async def _no_thread(func, /, *args, **kwargs):
        raise RuntimeError("can't start new thread")

    monkeypatch.setattr(R.asyncio, "to_thread", _no_thread)
    provider = _FakeProvider(
        [
            _ev(kind=EVENT_PERMISSION_REQUEST, tool_kind="fsRead", request_id="r1"),
            _ev(kind=EVENT_COMPLETE),
        ]
    )
    res = await _drive(R.SessionAgentRunner(), provider)

    assert res.ok is True
    assert provider.rejected == ["r1"] and provider.approved == []


@pytest.mark.asyncio
async def test_run_async_cancelled_while_awaiting_the_governance_call_never_approves(
    monkeypatch, fake_sel
):
    import threading

    from kiro_crew.testing.wait import FALLBACK_TIMEOUT_SECS, async_wait_until

    entered, release = threading.Event(), threading.Event()

    def _held_gate(ev, **_kw) -> str:
        entered.set()
        release.wait(FALLBACK_TIMEOUT_SECS)
        return ""

    monkeypatch.setattr(R, "_governance_denial", _held_gate)
    provider = _FakeProvider(
        [
            _ev(kind=EVENT_PERMISSION_REQUEST, tool_kind="fsRead", request_id="r1"),
            _ev(kind=EVENT_COMPLETE),
        ]
    )
    task = asyncio.ensure_future(_drive(R.SessionAgentRunner(), provider))
    await async_wait_until(entered.is_set)
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert provider.approved == []  # the request was never approved
    assert provider.rejected == []  # it ends unanswered with the run: denied by omission
