"""Every git tree the app removes goes through ``rmtree_force``, which clears the
read-only bit git sets on its objects, so Windows can delete it.

Ported from the auto-improvement cases of Kiro Crew's
``test/test_git_tree_removal_windows.py``: the PR watchers' clone removal (its own
clone, and an orphan the sweep reclaims) on a filesystem where a read-only file
cannot be unlinked, simulated everywhere and for real on Windows; and the source
scan, over this app's six git-tree removal sites.
"""

from __future__ import annotations

import ast
import os
from pathlib import Path
from typing import Iterator

import pytest
from windows_sim import readonly_unlink_refused

from auto_improvement.backend import pr_watchers as W
from kiro_crew import platform_compat

#: The real read-only attribute exists only on Windows, so that parameter is collected
#: only there. The simulated one runs everywhere.
_READ_ONLY_PARAMS = ["simulated"] if platform_compat.IS_POSIX else ["simulated", "real"]

_PACK = "pack-0123456789abcdef0123456789abcdef01234567.pack"
_APP_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(params=_READ_ONLY_PARAMS)
def read_only_objects(request: pytest.FixtureRequest) -> Iterator[None]:
    """Run where a read-only file cannot be unlinked: simulated anywhere, for real on Windows."""
    if request.param == "real":
        yield
        return
    with readonly_unlink_refused():
        yield


def _plant_checkout(root: Path) -> Path:
    """What ``git clone`` leaves at *root*: a pack and a loose object, both read-only."""
    pack = root / ".git" / "objects" / "pack" / _PACK
    loose = root / ".git" / "objects" / "ab" / ("c" * 38)
    for blob in (pack, loose):
        blob.parent.mkdir(parents=True, exist_ok=True)
        blob.write_bytes(b"PACK")
        os.chmod(blob, 0o444)
    (root / "app.json").write_text("{}", encoding="utf-8")
    return pack


class TestRemovingAGitTreeClearsTheReadOnlyBit:
    def test_a_watchers_clone_is_removed_with_its_objects(
        self, tmp_path: Path, read_only_objects: None
    ) -> None:
        reg = W.PRWatcherRegistry(
            autostart=False, isolate_clone=False, clones_root=str(tmp_path / "clones")
        )
        mine = Path(reg._clone_dir("fp1"))
        _plant_checkout(mine)

        reg._cleanup_clone(W.WatcherState(fp="fp1", pr="x"), str(mine))

        assert not mine.exists()

    def test_an_unowned_clone_is_reclaimed_with_its_objects(
        self, tmp_path: Path, read_only_objects: None
    ) -> None:
        reg = W.PRWatcherRegistry(
            autostart=False, isolate_clone=False, clones_root=str(tmp_path / "clones")
        )
        orphan = tmp_path / "orphan"
        _plant_checkout(orphan)

        assert W._delete_clone_if_unowned(reg, orphan) is True
        assert not orphan.exists()


#: (file under the app root, function, the tree it removes as written at the call).
#: Each tree is one git produced: a clone, a ``--local`` clone, or a ``.git`` directory.
_GIT_TREE_SITES = [
    ("backend/pr_watchers.py", "setup_isolated_clone", "dest"),
    ("backend/pr_watchers.py", "PRWatcherRegistry._cleanup_clone", "clone"),
    ("backend/pr_watchers.py", "_delete_clone_if_unowned", "child"),
    ("spine/gate.py", "Gate.run_bug", "base_src.parent"),
    ("spine/gate.py", "Gate._stage_test_only_base", "base_tree"),
    ("spine/gate.py", "Gate._stage_test_only_base", "gitlink"),
]

_HELPERS = frozenset({"rmtree_force", "_rmtree_force_settled"})


def _names(node: ast.AST, wanted: frozenset[str] | set[str]) -> bool:
    if isinstance(node, ast.Attribute):
        return node.attr in wanted
    return isinstance(node, ast.Name) and node.id in wanted


def _find_function(tree: ast.AST, qualname: str) -> ast.AST | None:
    def walk(node: ast.AST, prefix: str) -> ast.AST | None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                name = f"{prefix}{child.name}"
                if name == qualname:
                    return child
                found = walk(child, f"{name}.")
            else:
                found = walk(child, prefix)
            if found is not None:
                return found
        return None

    return walk(tree, "")


def _removed_trees(scope: ast.AST) -> tuple[list[str], list[str]]:
    """(trees ``shutil.rmtree`` removes, trees the helper removes) written inside *scope*.

    A reference counts whether it is called (``rmtree(x)``) or handed to a thread
    (``to_thread(rmtree, x)``, ``run_in_executor(None, rmtree, x)``).
    """
    bare: list[str] = []
    routed: list[str] = []
    for call in (n for n in ast.walk(scope) if isinstance(n, ast.Call)):
        references = [(call.func, call.args)]
        references += [(arg, call.args[i + 1 :]) for i, arg in enumerate(call.args)]
        for reference, rest in references:
            if not rest:
                continue
            if _names(reference, {"rmtree"}):
                bare.append(ast.unparse(rest[0]))
            elif _names(reference, _HELPERS):
                routed.append(ast.unparse(rest[0]))
    return bare, routed


class TestEverySiteUsesTheOneHelper:
    @pytest.mark.parametrize(
        ("rel", "qualname", "tree"),
        _GIT_TREE_SITES,
        ids=[f"{rel.rsplit('/', 1)[-1]}::{qualname}" for rel, qualname, _ in _GIT_TREE_SITES],
    )
    def test_a_git_tree_is_never_removed_by_shutil_rmtree(
        self, rel: str, qualname: str, tree: str
    ) -> None:
        source = (_APP_ROOT / rel).read_text(encoding="utf-8")
        scope = _find_function(ast.parse(source), qualname)
        assert scope is not None, f"{rel} no longer defines {qualname}; update _GIT_TREE_SITES"

        bare, routed = _removed_trees(scope)

        assert tree not in bare, f"{qualname} removes {tree} with shutil.rmtree"
        assert tree in routed, f"{qualname} does not remove {tree} through rmtree_force"

    def test_the_scan_sees_each_spelling(self) -> None:
        scope = ast.parse(
            "async def f(a, b, c, d):\n"
            "    shutil.rmtree(a, ignore_errors=True)\n"
            "    await asyncio.to_thread(shutil.rmtree, b, True)\n"
            "    platform_compat.rmtree_force(c)\n"
            "    await loop.run_in_executor(None, _rmtree_force_settled, d)\n"
        )

        assert _removed_trees(scope) == (["a", "b"], ["c", "d"])
