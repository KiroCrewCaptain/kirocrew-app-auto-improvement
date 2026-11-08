"""What an existing user's copy of the built-in needs from this repository.

Kiro Crew adopts a user's built-in record onto an external repository in place, at a
pinned commit, so the tree must be something it can take over unchanged:

- the same name, version, permissions, dependencies, platform, ``defaultEnabled``,
  agents, skills and MCP server tool set as the built-in
  (``tests/fixtures/builtin-app.json`` is its manifest at the commit this was ported
  from); a widened grant would be held back or force the app off;
- hooks that load the way the gateway loads them, from their file path into a
  synthetic package, with ``spine`` and ``profiles`` reached relatively, and that
  serve real requests through the gateway's own ``RouteRegistry``;
- a stdio MCP server the gateway can start from the app's own tree;
- nothing that needs a build at install time, and no links or file names a Windows
  checkout cannot hold;
- a committed UI bundle that imports only the seven modules the dashboard provides,
  and from the two SDK modules only names every supported host exports;
- ``minKiroCrewVersion`` set, so a host without the App Kit level-1 seams refuses a
  fresh install instead of serving a half-working app;
- no hardcoded model id anywhere.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from unittest import mock

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

APP_ROOT = Path(__file__).resolve().parents[1]
BUNDLE = APP_ROOT / "ui" / "dist" / "index.mjs"

HOST_MODULES = {
    "react",
    "react-dom",
    "react/jsx-runtime",
    "lucide-react",
    "@tanstack/react-query",
    "@kirocrew/app-sdk",
    "@kirocrew/app-sdk/ui",
}

# What a host BEFORE App Kit level 1 exports from each SDK module. A named import from
# these modules must stay in this set; a level-1 name is read off a namespace import in
# ui/src/hostSdk.ts.
LEVEL0_EXPORTS = {
    "@kirocrew/app-sdk": {
        "useAppApi",
        "useAppEvents",
        "useTheme",
        "useAppInfo",
        "useNavigate",
        "useNotify",
        "useNavBadge",
        "useChatLauncher",
        "AppApiProvider",
        "useImeGuard",
        "useLanguageGeneration",
        "activeLocale",
        "fmtNumber",
        "fmtDate",
        "fmtTime",
        "fmtDateTime",
        "fmtRelative",
        "compareText",
    },
    "@kirocrew/app-sdk/ui": {
        "Card",
        "CardTitle",
        "Btn",
        "SendBtn",
        "Input",
        "SearchInput",
        "Badge",
        "SourceBadge",
        "StatCard",
        "Skeleton",
        "ContentSkeleton",
        "EmptyState",
        "PageHeader",
        "Toggle",
        "InfoTip",
        "SegmentedControl",
        "MarkdownRenderer",
        "Clickable",
        "Modal",
        "ErrorNotice",
        "SettingsSection",
        "SettingsCard",
        "SettingsInput",
        "SettingsToggle",
        "SettingsSelect",
    },
}

_UNTRACKED_DIRS = {".git", "node_modules", "__pycache__", ".pytest_cache", ".venv"}
_WINDOWS_RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])$", re.IGNORECASE)
_STATIC_IMPORT = re.compile(
    r"^import\s+(?:(?P<clause>[^'\"]+?)\s+from\s+)?[\"'](?P<spec>[^\"']+)[\"'];?\s*$",
    re.MULTILINE,
)


def _manifest() -> dict:
    return json.loads((APP_ROOT / "app.json").read_text(encoding="utf-8"))


def _builtin() -> dict:
    return json.loads((APP_ROOT / "tests" / "fixtures" / "builtin-app.json").read_text("utf-8"))


def _text() -> str:
    return BUNDLE.read_text(encoding="utf-8")


def _bundle_imports() -> list[tuple[str, str]]:
    return [(m["spec"], (m["clause"] or "").strip()) for m in _STATIC_IMPORT.finditer(_text())]


def _named(clause: str) -> set[str]:
    match = re.search(r"\{([^}]*)\}", clause)
    if not match:
        return set()
    return {part.split(" as ")[0].strip() for part in match.group(1).split(",") if part.strip()}


def _tree() -> list[Path]:
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(APP_ROOT):
        dirnames[:] = [d for d in dirnames if d not in _UNTRACKED_DIRS]
        files += [Path(dirpath) / name for name in filenames if not name.endswith(".pyc")]
        files += [Path(dirpath) / d for d in dirnames if (Path(dirpath) / d).is_symlink()]
    return files


class TestTheBundle:
    def test_the_entry_the_manifest_names_is_committed(self) -> None:
        ui = _manifest()["ui"]
        assert ui["entry"] == "dist/index.mjs"
        assert (APP_ROOT / "ui" / ui["entry"]).is_file(), "run `npm run build` in ui/"

    def test_it_imports_only_what_the_host_provides(self) -> None:
        imports = _bundle_imports()
        assert imports, "no import statements found; the scan is broken"
        starts = re.findall(r"^import\b", _text(), re.MULTILINE)
        assert len(starts) == len(imports), "an import the scan could not parse"
        assert {spec for spec, _ in imports} <= HOST_MODULES
        assert not re.search(r"\bimport\s*\(", _text()), "a dynamic import loads a second file"

    def test_named_sdk_imports_exist_on_every_supported_host(self) -> None:
        for spec, clause in _bundle_imports():
            if spec in LEVEL0_EXPORTS:
                assert _named(clause) <= LEVEL0_EXPORTS[spec], spec

    def test_level_1_names_are_feature_detected(self) -> None:
        assert '"Select" in ' in _text()

    def test_no_build_machine_path_is_baked_in(self) -> None:
        assert not re.search(r"/(?:home|Users|workplace)/|[A-Za-z]:\\\\", _text())


class TestTheManifest:
    def test_declares_the_first_kiro_crew_with_the_seams(self) -> None:
        assert re.fullmatch(r"\d+\.\d+\.\d+", _manifest().get("minKiroCrewVersion", ""))

    def test_what_adoption_compares_is_the_builtins(self) -> None:
        manifest, builtin = _manifest(), _builtin()
        for key in (
            "name",
            "version",
            "permissions",
            "dependencies",
            "defaultEnabled",
            "platform",
            "agents",
            "skills",
        ):
            assert manifest.get(key) == builtin.get(key), key

    def test_the_display_fields_are_the_builtins(self) -> None:
        manifest, builtin = _manifest(), _builtin()
        for key in (
            "displayName",
            "description",
            "author",
            "tags",
            "highlights",
            "useCases",
            "configuration",
        ):
            assert manifest[key] == builtin[key], key

    def test_the_mcp_server_keeps_the_builtins_name_and_tools(self) -> None:
        """The same server key and auto-approved read-only tools, launched from this tree."""
        ours = _manifest()["mcpServers"]
        theirs = _builtin()["mcpServers"]
        assert set(ours) == set(theirs) == {"auto-improvement"}
        entry = ours["auto-improvement"]
        assert entry["autoApprove"] == theirs["auto-improvement"]["autoApprove"]
        assert entry["command"] == "python3"
        assert entry["args"] == ["backend/mcp_launch.py"]
        assert (APP_ROOT / entry["args"][0]).is_file()
        assert not any("kiro_crew" in arg for arg in entry["args"])

    def test_adoption_carries_the_server_from_this_tree(self) -> None:
        """Kiro Crew's own E10 check (``adopted_mcp_servers_refusal``) accepts this
        tree's server against the built-in's declaration: a bare ``python3`` and a
        ``.py`` launcher inside the tree, no tool or ``env`` entry beyond the
        built-in's. A ``-m`` launch, which would run the wheel copy, is refused."""
        from kiro_crew.apps.builtin_adoption_mcp import adopted_mcp_servers_refusal
        from kiro_crew.apps.manifest import AppManifest

        ours = AppManifest.from_json_file(APP_ROOT / "app.json")
        wheel = AppManifest.from_dict(_builtin())
        assert adopted_mcp_servers_refusal(ours, APP_ROOT, wheel) is None
        assert adopted_mcp_servers_refusal(wheel, APP_ROOT, wheel) == "pinned_feature_unsupported"

    def test_the_page_carries_no_glyph_of_its_own(self) -> None:
        """The legacy route and sidebar glyph come from Kiro Crew's pin, not from here."""
        assert _manifest()["ui"]["pages"] == [
            {"route": "/apps/auto-improvement", "label": "Auto-Improve"}
        ]

    def test_declares_nothing_else_adoption_cannot_carry(self) -> None:
        manifest = _manifest()
        assert "overlays" not in manifest["ui"]
        assert "sessionApproval" not in manifest
        assert manifest["defaultEnabled"] is False

    def test_listing_copy_matches_the_bundled_catalogs(self) -> None:
        manifest = _manifest()
        catalogs = {
            p.stem: json.loads(p.read_text(encoding="utf-8"))["apps"]["autoImprovement"]["manifest"]
            for p in sorted((APP_ROOT / "ui" / "i18n").glob("*.json"))
        }
        english = catalogs.pop("en")
        assert manifest["displayName"] == english["display_name"]
        assert manifest["description"] == english["description"]
        assert manifest["ui"]["pages"][0]["label"] == english["page_label"]
        count = len(manifest["highlights"])
        assert manifest["highlights"] == [english[f"highlight_{i}"] for i in range(1, count + 1)]
        assert set(manifest["l10n"]) == set(catalogs)
        for locale, strings in catalogs.items():
            assert manifest["l10n"][locale] == {
                "displayName": strings["display_name"],
                "description": strings["description"],
                "pageLabel": strings["page_label"],
                "highlights": [strings[f"highlight_{i}"] for i in range(1, count + 1)],
            }, locale

    def test_l10n_is_within_the_host_parser_limits(self) -> None:
        l10n = _manifest()["l10n"]
        assert len(l10n) <= 32
        for locale, entry in l10n.items():
            assert re.fullmatch(r"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?", locale)
            assert set(entry) <= {"displayName", "description", "pageLabel", "highlights"}
            assert len(entry["displayName"]) <= 120
            assert len(entry["description"]) <= 1000
            assert len(entry["pageLabel"]) <= 60
            assert len(entry["highlights"]) <= 12
            assert all(len(h) <= 300 for h in entry["highlights"])

    def test_art_is_repo_relative_png(self) -> None:
        manifest = _manifest()
        for key in (
            "iconPath",
            "heroImage",
            "heroImageDark",
            "heroImageDetail",
            "heroImageDetailDark",
        ):
            assert re.fullmatch(r"assets/[a-z0-9-]+\.png", manifest[key]), key
            assert (APP_ROOT / manifest[key]).is_file(), key
        for shot in manifest["screenshots"]:
            assert (APP_ROOT / shot).is_file(), shot

    def test_agents_and_skills_ship_in_this_tree(self) -> None:
        manifest = _manifest()
        names = set()
        for rel in manifest["agents"]:
            spec = json.loads((APP_ROOT / rel).read_text(encoding="utf-8"))
            names.add(spec["name"])
            assert spec.get("model") in (None, "auto"), rel
        assert names == {
            "auto-improvement-discovery",
            "auto-improvement-pr-author",
            "auto-improvement-scout",
            "auto-improvement-engineer",
        }
        for rel in manifest["skills"]:
            assert (APP_ROOT / rel / "SKILL.md").is_file(), rel

    def test_the_hooks_load_and_serve_through_the_gateway(self) -> None:
        """Through the gateway's own module loader and RouteRegistry: a synthetic package,
        relative imports into ``spine`` and ``profiles``, and a real request answered."""
        import asyncio
        import sys

        # Unloading also purges every module imported from the app's own files under
        # another name, which is how this suite imports the app (``auto_improvement``)
        # and its own test modules;
        # put those back so the rest of the run keeps one copy of each module.
        def _ours(key: str, module: object) -> bool:
            if key == "auto_improvement" or key.startswith("auto_improvement."):
                return True
            file = getattr(module, "__file__", None)
            return bool(file) and APP_ROOT in Path(file).resolve().parents

        # The test modules and helpers (``tests.*``, ``harness``, ...) load from the app
        # tree too, and are purged with it.
        ours = {key: module for key, module in list(sys.modules.items()) if _ours(key, module)}
        try:
            asyncio.run(self._serve_through_the_registry())
        finally:
            sys.modules.update(ours)
            # And each one bound on its parent package again, as an import binds it.
            for key, module in ours.items():
                parent, _, leaf = key.rpartition(".")
                if parent in ours:
                    setattr(ours[parent], leaf, module)

    async def _serve_through_the_registry(self) -> None:
        from kiro_crew.apps import module_loader
        from kiro_crew.apps.context import AppContext
        from kiro_crew.apps.module_loader import load_app_module, unload_app_modules
        from kiro_crew.apps.route_registry import RouteRegistry

        name = "auto-improvement-loadcheck"
        app = web.Application()
        registry = RouteRegistry(app)
        ctx = AppContext(name=name, data_dir=APP_ROOT / ".loadcheck-unused", http_app=app)
        hooks = _manifest()["backend"]["hooks"]
        # The operator's trust decision is not what this checks; loading is.
        with mock.patch.object(module_loader, "app_execution_denied", return_value=None):
            try:
                loaded = {
                    hook: load_app_module(name, APP_ROOT, target) for hook, target in hooks.items()
                }
                for fn in loaded.values():
                    assert callable(fn)
                    assert fn.__module__ == f"_kirocrew_app_{name}.backend.hooks"
                # The hook entry is executed once per hook; what they share is one copy.
                shared = {id(fn.__globals__["routes"]) for fn in loaded.values()}
                assert len(shared) == 1
                descriptions = await registry.register_app_routes(
                    name, APP_ROOT, hooks["routes"], ctx
                )
                assert len(descriptions) >= 30
                async with TestClient(TestServer(app)) as client:
                    resp = await client.get(f"/api/apps/{name}/health")
                    assert resp.status == 200
                    body = await resp.json()
                    assert body["ok"] is True
                    resp = await client.get(f"/api/apps/{name}/findings/not%20a%20fp")
                    assert resp.status == 400
            finally:
                registry.deregister_app_routes(name)
                unload_app_modules(name)


# A model id literal in code: the families Kiro Crew's own review gate refuses.
_MODEL_LITERAL = re.compile(r"""["'`](?:claude-|opus|sonnet|haiku|gpt-|fable)[\w.:-]*["'`]""", re.I)
#: Literals of that shape that name no model: the subprocess runner's audit row names
#: the tool it ran (``tool_name="claude-cli"``), the built-in's own label.
_NOT_MODEL_IDS = {("spine/agent_runner.py", '"claude-cli"')}


class TestNoHardcodedModel:
    def test_no_model_id_literal_in_the_app(self) -> None:
        roots = [APP_ROOT / d for d in ("backend", "spine", "profiles", "agents")] + [
            APP_ROOT / "ui" / "src"
        ]
        found = []
        for root in roots:
            for path in sorted(root.rglob("*")):
                if (
                    path.suffix in {".py", ".ts", ".tsx", ".json"}
                    and "__pycache__" not in path.parts
                ):
                    rel = path.relative_to(APP_ROOT).as_posix()
                    for m in _MODEL_LITERAL.finditer(path.read_text(encoding="utf-8")):
                        if (rel, m.group(0)) not in _NOT_MODEL_IDS:
                            found.append(f"{rel}: {m.group(0)}")
        assert found == []


class TestTheTreeIsAdoptable:
    @pytest.mark.parametrize(
        "name", ["package.json", "pyproject.toml", "setup.py", "requirements.txt", ".gitattributes"]
    )
    def test_no_root_build_file(self, name: str) -> None:
        assert not (APP_ROOT / name).exists()

    def test_no_link_and_no_unportable_name(self) -> None:
        seen: dict[str, str] = {}
        for path in _tree():
            rel = path.relative_to(APP_ROOT).as_posix()
            assert not path.is_symlink(), f"{rel}: a link is refused by adoption"
            assert path.is_file(), f"{rel}: only regular files"
            assert not re.search(r"[\\:]", rel), rel
            for part in rel.split("/"):
                assert not part.endswith((".", " ")), rel
                assert _WINDOWS_RESERVED.match(part.split(".")[0]) is None, rel
            assert (
                rel.lower() not in seen
            ), f"{rel} differs only in case from {seen.get(rel.lower())}"
            seen[rel.lower()] = rel

    def test_the_tree_is_within_the_adoption_caps(self) -> None:
        files = _tree()
        assert len(files) <= 5000
        assert sum(p.stat().st_size for p in files) <= 64 * 1024 * 1024
