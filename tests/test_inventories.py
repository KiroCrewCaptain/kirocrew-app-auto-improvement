"""Every node id in the two test inventories names a test that exists.

A stale line would mark nothing, so the gap it records would go untracked.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

TESTS = Path(__file__).resolve().parent


def _ids(name: str) -> list[str]:
    lines = (TESTS / name).read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip() and not line.startswith("#")]


def _defined(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            found.add(node.name)
        elif isinstance(node, ast.ClassDef):
            for inner in node.body:
                if isinstance(inner, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    found.add(f"{node.name}::{inner.name}")
    return found


@pytest.mark.parametrize("inventory", ["windows-expected-failures.txt", "requires-real-symlinks.txt"])
def test_every_listed_test_exists(inventory: str) -> None:
    ids = _ids(inventory)
    assert ids
    for node in ids:
        file, _, rest = node.partition("::")
        rest = rest.split("[", 1)[0]
        path = TESTS.parent / file
        assert path.is_file(), node
        assert rest in _defined(path), node
