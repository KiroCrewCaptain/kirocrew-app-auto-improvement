"""This repository's source tree as data, for the tests that scan it.

Kiro Crew's own tree scans read its checkout through ``test/source_corpus.py``
(``src/kiro_crew`` and the test trees). The scans ported from it read this
repository instead: the app code the gateway loads (``backend``, ``spine``,
``profiles``, named as the test session imports them, ``auto_improvement.<...>``)
and the test tree (``tests/`` and the root ``conftest.py``).
"""

from __future__ import annotations

import ast
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "auto_improvement"
#: The directories that hold the app's code.
APP_CODE_DIRS = ("backend", "spine", "profiles")
#: The host-shim calls that bind a gateway name, the way ``from kiro_crew.x import y`` did.
_HOST_BINDERS = frozenset({"need", "require", "need_module", "require_module"})


def app_sources() -> dict[str, str]:
    """Dotted module name -> source, for every module of the app's code."""
    found: dict[str, str] = {}
    for top in APP_CODE_DIRS:
        for path in sorted((APP_ROOT / top).rglob("*.py")):
            parts = path.relative_to(APP_ROOT).with_suffix("").parts
            if parts[-1] == "__init__":
                parts = parts[:-1]
            found[".".join((PACKAGE, *parts))] = path.read_text(encoding="utf-8")
    return found


def test_tree_texts(*needles: str, exclude: Path | None = None) -> list[tuple[str, str]]:
    """(path, text) of every test-tree file that contains one of *needles*."""
    found = []
    paths = [APP_ROOT / "conftest.py", *sorted((APP_ROOT / "tests").rglob("*.py"))]
    for path in paths:
        if exclude is not None and path.resolve() == exclude.resolve():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if any(needle in text for needle in needles):
            found.append((path.relative_to(APP_ROOT).as_posix(), text))
    return found


def host_bound_names(tree: ast.Module) -> frozenset[str]:
    """Top-level names a module binds from the gateway through ``_host``.

    ``name = _host.need("module", "name")`` is the port's spelling of the built-in's
    ``from kiro_crew.module import name``: an import, not a definition.
    """
    names: set[str] = set()
    for node in tree.body:
        if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Call):
            continue
        func = node.value.func
        if (
            isinstance(func, ast.Attribute)
            and func.attr in _HOST_BINDERS
            and isinstance(func.value, ast.Name)
            and func.value.id == "_host"
        ):
            names.update(t.id for t in node.targets if isinstance(t, ast.Name))
    return frozenset(names)
