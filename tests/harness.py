"""Serve the backend the way the gateway's RouteRegistry and lifecycle do.

The registry mounts one catch-all at ``/api/apps/{app_name}/{path}``, matches
the remainder against each route record, injects path params into
``match_info`` and calls ``handler(request, ctx)``; the lifecycle dispatcher
calls ``on_startup(ctx)`` and ``on_shutdown(ctx)``. :func:`mount` does the same
on a test's own ``web.Application``, with aiohttp's router doing the matching
under the same prefix, so a test request uses the URL a dashboard request uses
and ``ctx.http_app`` is that application, as the gateway's is.

``tests/test_manifest_contract.py`` separately serves the hooks through the
gateway's own module loader and ``RouteRegistry``.
"""

from __future__ import annotations

from typing import Any

from aiohttp import web

PREFIX = "/api/apps/auto-improvement"


def mount(app: web.Application, ctx: Any = None, *, lifecycle: bool = True) -> Any:
    """Register the app's routes (and, by default, its lifecycle hooks) on *app*.

    Returns the context, whose ``http_app`` is *app*. With no *ctx*, the bound
    one (the autouse ``bound_ctx`` fixture's) is reused.
    """
    from auto_improvement.backend import _host, hooks

    if ctx is None:
        ctx = _host.bound()
    ctx.http_app = app
    for route in hooks.register_routes(ctx):

        async def _dispatch(request: web.Request, _route=route) -> web.StreamResponse:
            return await _route.handler(request, ctx)

        app.router.add_route(route.method, PREFIX + route.path, _dispatch)

    if lifecycle:

        async def _start(_app: web.Application) -> None:
            await hooks.on_startup(ctx)

        async def _stop(_app: web.Application) -> None:
            await hooks.on_shutdown(ctx)

        app.on_startup.append(_start)
        app.on_shutdown.append(_stop)
    return ctx
