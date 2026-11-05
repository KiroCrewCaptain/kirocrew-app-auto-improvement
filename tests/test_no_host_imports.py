"""Only the host shim reaches Kiro Crew, and only through ``importlib``.

The gateway's public surface for an app is the ``AppContext`` its hooks get and the
structural route records the registry accepts. Auto-Improvement also drives gateway
services no App Kit seam provides yet (the OS sandbox, the hook manager and transport
floor, crew members and their sessions, the platform redactor, owner-only files; see
PORTING.md). Those are resolved from the running gateway in ``backend/_host.py`` alone,
by name, through ``importlib``, so a missing one refuses the operation instead of
breaking the module load. No other module of the app (``backend``, ``spine``,
``profiles``) may import ``kiro_crew`` in any form or name one of its modules, and the
shim has no top-level ``kiro_crew`` import.
"""

from __future__ import annotations

import ast
import re
import tempfile
import unittest
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
_APP_CODE = ("backend", "spine", "profiles")
_SHIM = APP_ROOT / "backend" / "_host.py"

#: String literals that spell ``kiro_crew`` for a reason other than reaching the host:
#: ``agent_discovery.source_root`` recognises a TARGET repository laid out as
#: ``src/kiro_crew`` (Kiro Crew's own checkout is a repository this app can improve).
_NOT_HOST_REFERENCES = {("spine/agent_discovery.py", "kiro_crew")}


def _host_imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found += [a.name for a in node.names if a.name.split(".")[0] == "kiro_crew"]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if node.module.split(".")[0] == "kiro_crew":
                found.append(node.module)
        elif isinstance(node, ast.Call):
            # importlib.import_module("kiro_crew...") / __import__("kiro_crew...")
            name = getattr(node.func, "attr", None) or getattr(node.func, "id", None)
            if name in {"import_module", "__import__"} and node.args:
                arg = node.args[0]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    if arg.value.split(".")[0] == "kiro_crew":
                        found.append(arg.value)
    return found


def _host_strings(path: Path) -> list[str]:
    """String literals naming a ``kiro_crew`` module."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    rel = path.relative_to(APP_ROOT).as_posix()
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and re.fullmatch(r"kiro_crew(\.[a-z_]+)*", node.value)
        and (rel, node.value) not in _NOT_HOST_REFERENCES
    ]


def _app_files() -> list[Path]:
    return sorted(p for top in _APP_CODE for p in (APP_ROOT / top).rglob("*.py"))


class TestNoHostImports(unittest.TestCase):
    def test_no_app_module_but_the_host_shim_reaches_kiro_crew(self) -> None:
        files = _app_files()
        self.assertGreater(len(files), 50, "the app's modules were not found")
        for path in files:
            if path == _SHIM:
                continue
            with self.subTest(module=path.relative_to(APP_ROOT).as_posix()):
                self.assertEqual(_host_imports(path), [])
                self.assertEqual(_host_strings(path), [])

    def test_the_host_shim_imports_kiro_crew_only_at_call_time(self) -> None:
        tree = ast.parse(_SHIM.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = (
                    [a.name for a in node.names]
                    if isinstance(node, ast.Import)
                    else [node.module or ""]
                )
                self.assertFalse(any(n.split(".")[0] == "kiro_crew" for n in names), names)
        self.assertEqual(_host_imports(_SHIM), [])

    def test_the_facades_import_only_their_own_owners(self) -> None:
        """``driver`` and ``agent_runner`` import their owner modules by a name built from
        their own ``__package__``, never by a literal, so no host module can be named."""
        for rel in ("spine/driver.py", "spine/agent_runner.py"):
            tree = ast.parse((APP_ROOT / rel).read_text(encoding="utf-8"))
            owners = next(
                node.value
                for node in ast.walk(tree)
                if isinstance(node, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "_OWNERS" for t in node.targets)
            )
            with self.subTest(module=rel):
                self.assertIsInstance(owners, ast.Tuple)
                for element in owners.elts:
                    self.assertIsInstance(element, ast.JoinedStr)
                    self.assertIn("__package__", ast.unparse(element))

    def test_the_scan_sees_each_import_form(self) -> None:
        """The detector itself: every spelling it must catch is caught."""
        source = (
            "import kiro_crew\n"
            "import kiro_crew.apps as a\n"
            "from kiro_crew.executors import run_in_embed_pool\n"
            "import importlib\n"
            "importlib.import_module('kiro_crew.embeddings')\n"
            "__import__('kiro_crew')\n"
            "from . import kiro_crew_like\n"
            "import kiro_crewish\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "probe.py"
            path.write_text(source, encoding="utf-8")
            self.assertEqual(
                _host_imports(path),
                [
                    "kiro_crew",
                    "kiro_crew.apps",
                    "kiro_crew.executors",
                    "kiro_crew.embeddings",
                    "kiro_crew",
                ],
            )


if __name__ == "__main__":
    unittest.main()
