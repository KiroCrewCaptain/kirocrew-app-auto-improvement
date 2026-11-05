"""The three ``backend.hooks`` entries the manifest names: routes, startup, shutdown.

The gateway executes a hook entry file once per hook it names, each time as a
fresh module, so this module holds no state of its own: everything it touches
(the supervisor, the watcher registry, the crew runtime, the bound context) lives
in the sibling modules it imports, which load once and are shared.

* :func:`register_routes` binds the context and returns the route records
  (:mod:`.routes`).
* :func:`on_startup` runs on gateway start and on enable. It gives the watcher
  registry the gateway's event loop, attaches the member session runtime from
  the gateway's dashboard state (``ctx.http_app["state"]``), provisions the
  Scout and Engineer crew members off the loop, and builds the run supervisor,
  whose first read saves a run an in-place restart cut off as interrupted.
* :func:`on_shutdown` runs on disable (inside the disable request, before the
  enabled flag is written), on uninstall, on reload and at gateway exit. It asks
  every PR watcher and the run to stand down. The built-in reached the same
  stops through ``on_cleanup`` plus an app-disable hook; one hook covers both.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from . import _host, crew, pr_watchers, routes, runner, store

logger = logging.getLogger("kirocrew.app.auto-improvement")


def register_routes(ctx: Any) -> list[_host.Route]:
    return routes.register_routes(ctx)


async def on_startup(ctx: Any) -> None:
    _host.bind(ctx)
    try:
        pr_watchers.attach_loop(asyncio.get_running_loop())
        crew.attach_gateway(_host.dashboard_state(ctx))
    except Exception:  # pragma: no cover - never break gateway startup
        logger.warning("%s: could not bind the watcher loop", store.APP_NAME, exc_info=True)
    await crew.on_startup(ctx)


async def _stop_watchers() -> None:
    try:
        # Off the loop: ``stop_all`` only sets flags, but it takes the registry lock,
        # which the orphan-clone sweep holds across a ``shutil.rmtree``.
        await asyncio.to_thread(lambda: pr_watchers.get_registry().stop_all())
    except Exception:  # pragma: no cover - defensive
        logger.warning("%s: watcher shutdown failed", store.APP_NAME, exc_info=True)


async def _stop_run() -> None:
    try:
        # The lookup rides inside the hop: on first use it builds the supervisor, which
        # reads the run record back from disk.
        await asyncio.to_thread(lambda: runner.get_supervisor().stop())
    except Exception:  # pragma: no cover - defensive
        logger.warning("%s: run shutdown failed", store.APP_NAME, exc_info=True)


async def on_shutdown(ctx: Any) -> None:
    """Stand every worker down; each stop is contained so one failure cannot skip the other."""
    await _stop_watchers()
    await _stop_run()
