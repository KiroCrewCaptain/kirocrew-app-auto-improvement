"""Make the app root importable as the package ``auto_improvement`` for the tests.

The gateway loads the app's hook files into a synthetic package named after the
app, whose root is this directory, so ``backend``, ``spine`` and ``profiles`` are
sibling subpackages and their relative imports (``from ..spine import gate``)
resolve inside the app. A plain pytest run has no such loader, so this registers
the same shape under a fixed name before any test module is imported: the root
is a package whose ``__path__`` is this directory. Nothing here is on ``sys.path``,
so no app module can shadow a top-level module.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

PACKAGE = "auto_improvement"
APP_ROOT = Path(__file__).resolve().parent

if PACKAGE not in sys.modules:
    _root = types.ModuleType(PACKAGE)
    _root.__path__ = [str(APP_ROOT)]  # type: ignore[attr-defined]
    _root.__package__ = PACKAGE
    _root.__file__ = None
    sys.modules[PACKAGE] = _root
