"""Start the app's stdio MCP server: ``python3 backend/mcp_launch.py``.

The gateway resolves a stdio entry whose ``command`` is a bare ``python3`` and
whose first argument is a ``.py`` file inside the app to that file's absolute
path, and starts it with the gateway's own interpreter. Run as a script, this
file has no package, so it gives the app's tree one: it registers the app root as
a package under a name no other code uses, then imports
``backend.mcp_server`` from it, whose relative imports (``from . import deps``)
then resolve inside the app as they do under the gateway's hook loader.

``sys.path[0]`` is this file's directory when it runs as a script. It is removed
before anything is imported, so a module here (``store.py``, ``progress.py``) can
never shadow a top-level module the gateway or the standard library imports.
"""

from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path

#: The package the app root is registered under in this process.
PACKAGE = "_kirocrew_app_auto_improvement_mcp"


def _register_app_package() -> str:
    here = Path(__file__).resolve().parent
    if sys.path and Path(sys.path[0] or ".").resolve() == here:
        sys.path.pop(0)
    if PACKAGE not in sys.modules:
        root = types.ModuleType(PACKAGE)
        root.__path__ = [str(here.parent)]  # type: ignore[attr-defined]
        root.__package__ = PACKAGE
        sys.modules[PACKAGE] = root
    return PACKAGE


def main() -> None:
    package = _register_app_package()
    importlib.import_module(f"{package}.backend.mcp_server").main()


if __name__ == "__main__":
    main()
