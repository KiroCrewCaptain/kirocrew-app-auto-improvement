# Porting notes: built-in → external app

This repository was ported from Kiro Crew's built-in Auto-Improvement app at
KiroCrew `main` `55439d8770`:

- the app, `src/kiro_crew/apps/builtins/auto_improvement/` (`app.json`, `backend/`,
  `spine/`, `profiles/`, `agents/`, `skills/`, `docs/MANUAL.md`, `docs/PORT_PLAN.md`,
  and the 54 files of its own `tests/`);
- the dashboard page, `website/src/apps/auto-improvement/` (`AutoImprovementPage.tsx`,
  `SetupPanel.tsx`, `FindingDetail.tsx`, `lib/agentSession.ts`, `lib/prompts.ts` and
  three tests), and its store art, `website/public/app-assets/auto-improvement/`;
- the `apps.autoImprovement.*` and `autoImprovement.*` strings of
  `website/src/i18n/locales/*.json` (plus `en.manual.json`);
- the tests in Kiro Crew's own tree whose subject is this app: every
  `test/test_ai_*.py` but the `test_ai_review_*` CI-workflow suites,
  `test/test_auto_improvement_*.py`, `test/test_bug_keeper_*.py`,
  `test/test_bug_proposal_skip_status_default.py`,
  `test/test_bug_proposer_fan_out_overlap.py`, `test/test_spine_json_extraction.py`,
  `test/test_agent_runner_owner_bindings.py`, `test/test_driver_owner_bindings.py` (with
  their facade inventories), the helpers `test/ai_spine_driver_coverage_helpers.py` and
  `test/auto_improvement_member_helpers.py`, the auto-improvement cases of eleven mixed
  suites (listed under "Tests"), and `website/src/test/autoImprovement*.test.ts(x)`,
  `agentSessionFolderResolve.test.ts` and `agentSessionSeedReceipt.test.ts`.

Fixes the wheel copy took after that commit are ported here, each with its tests:
`5a679d8` (#30672, a run ended by a stop is recorded as `stopped`, not `done`) and
`5941a9c` (#32231, `POST /setup-clone` saves only the repository part of the pasted
URL, so a token pasted after the repository name never reaches `config.json`). The
wheel copy's other changes since then are test relocations into its own `tests/` and
comment rewording (#30076, #30043), which carry no behaviour. The test suite runs
against Kiro Crew `main` `6d07df11cf` (`tests/requirements.txt`).

The opt-in candidate admission check of kirodotdev/KiroCrew#32301 (#28012) is ported
with its tests: `candidateAdmissionCommand` names a project evidence checker that both
keep paths ask before the provisional commit, and only a fresh, matching `admitted`
answer keeps the candidate (`spine/candidate_admission.py`, `spine/driver.py`,
`backend/runner.py`, `docs/MANUAL.md` section 7, `tests/test_candidate_admission.py`).
The checker runs in the tests' sandbox, so `write_protected_targets` moved from
`profiles/github_repo/profile.py` to `spine/push_policy.py`, which both spawns share,
and `run_limited` and `sandboxed_spawn_argv` resolve through `_host.need` as the other
`kiro_crew.sandbox` names do.

Paths with a line number below refer to the snapshot commit. A **gap** is something the
built-in gets from Kiro Crew that an external app has no public way to get yet;
closing one is a Kiro Crew change (a generic, app-agnostic App Kit seam), not a
change here.

## What carried over unchanged

- `app.json` `name` (`auto-improvement`), `version` (`1.0.0`), `author`,
  `permissions`, `dependencies`, `platform`, `defaultEnabled: false`, `agents`,
  `skills`, the MCP server's key and auto-approved tools, and every display field
  (`displayName`, `description`, `tags`, `highlights`, `useCases`, `configuration`).
  `tests/test_manifest_contract.py` compares them with the built-in's manifest
  (`tests/fixtures/builtin-app.json`), because adoption refuses a manifest that
  widens a grant or forces the app off.
- `agents/*.json` and `skills/*/SKILL.md`, byte for byte, so the materialized agent
  names (`auto-improvement-discovery`, `-pr-author`, `-scout`, `-engineer`) and skill
  names (`ai-discover`, `metric-design`) are the built-in's.
- The whole improvement loop: `spine/` (discover, propose, gate, measure, keep or
  revert, archive, ledger, push policy, git safety, the PR pipeline), `profiles/`
  (the `github_repo` profile and its PR recipe) and `backend/` (clone setup, the run
  supervisor, the PR watchers, the commit path, the ledger admin, dependency checks,
  progress, SSE, the stdio MCP server). The files are the built-in's with their
  imports changed, the call sites listed below, and formatting by Kiro Crew's own
  `black` (26.10.1, line length 100).
- Every route's method, path, validation, status codes and response shape; the
  facades (`spine.driver`, `spine.agent_runner`) and the owner modules behind them;
  the run record and the restart rule that reports a run cut off by a restart as
  interrupted; every refusal (push not disabled, the sandbox below strict without
  consent, a protected branch, the watcher egress-risk opt-in, a project shadow of a
  member's agent).
- Where the app's data lives: `<data home>/apps/auto-improvement/data/` (the
  config, `repos/<key>/` per repository and branch, `sessions/`, `crew.json`),
  which is `ctx.data_dir`; disposable clones and worktrees stay under
  `AUTO_IMPROVEMENT_SCRATCH` (default `~/.autoimprove-scratch`); refused clones are
  still quarantined under `<data home>/quarantined-clones`, a leaf every agent
  sandbox masks (`sandbox._CREW_HIDDEN_LEAVES`). A user's existing data is read as
  it is: nothing of it lives beside `app.json`, so an update or adoption that keeps
  `data/` keeps all of it.
- The two persistent crew members (`auto-improvement-scout`,
  `auto-improvement-engineer`), with their ids, memory stores and workspaces, and the
  audit rows the built-in wrote (operation `auto_improvement.<verb>` for an allowed
  owner action, the runner's `auto-improvement-subprocess` rows).

## What changed, and why

| Built-in | Here | Why |
|---|---|---|
| `"backend": {"routes": "backend.routes:register_routes", "hooks": {"on_startup": "backend.crew:on_startup", "on_shutdown": "backend.crew:on_shutdown"}}` (`app.json:27-33`) | `"backend": {"hooks": {"routes", "on_startup", "on_shutdown"}}`, all three in `backend/hooks.py` | Top-level `backend.routes` is read only by the built-in boot loop (`apps/builtins/__init__.py`, `BUILTIN_NAMES`). The gateway executes a hook entry file once per hook it names, so `hooks.py` holds no state; everything it touches lives in the modules it imports once. |
| `register_routes(app)` adding 32 absolute routes, each wrapped in `_require_enabled` (`backend/routes.py:123-133`, `:1573-1612`) | `register_routes(ctx) -> list[Route]` (relative paths, `_ROUTE_TABLE`), handlers looked up by name at call time | The `hooks.routes` contract. `Route` is the app's own frozen dataclass (`backend/_host.py`), accepted structurally from App Kit level 1. The registry takes an app's routes down on disable, so a disabled app answers 404 and no handler reads the enabled flag; the `app_disabled` 403 is gone except at run start (below). |
| `app.on_startup` (`_bind_watcher_loop`: the watcher loop and `attach_gateway(app["state"])`), `app.on_cleanup` (`_stop_watchers`, `_stop_run`) and `teardown.register_app_disable_hook` (`backend/routes.py:1614-1729`) | `hooks.on_startup(ctx)` (loop, `ctx.http_app["state"]`, then the members and the supervisor) and `hooks.on_shutdown(ctx)` (watchers, then the run, each contained) | The gateway's application is frozen once it serves; an app must not append to it. The gateway calls `on_shutdown` inside the disable request before the enabled flag is written, and at uninstall, reload and exit, so one hook covers both of the built-in's stop paths. |
| `require_owner_dashboard_request(request, "auto_improvement.<verb>")` on 17 routes (`backend/routes.py:288-1556`) | `ctx.require_owner(request, "<verb>")` (`routes._require_owner`) | The level-1 owner gate, the same host predicate. The host prefixes the app's own name, so a DENIAL is now audited as `auto-improvement.<verb>`. A gateway without the seam refuses every caller, the owner included. |
| `store.data_dir()` = `app_data_dir("auto-improvement")` (`backend/store.py:52-56`) | `ctx.data_dir` of the bound context, created owner-only; the gateway's `app_data_dir` only where there is no context (the stdio MCP server) | An external app's data root is its context's. It is the same directory. |
| `"command": "python3", "args": ["-m", "kiro_crew.apps.builtins.auto_improvement.backend.mcp_server"]` (`app.json:34-50`) | `"args": ["backend/mcp_launch.py"]` | The gateway resolves a bare `python3` to its own interpreter and a `.py` operand inside the app to its absolute path. The launcher registers the app root as a package under a private name (and drops its own directory from `sys.path` first) so the server's relative imports resolve. |
| Absolute self-imports `kiro_crew.apps.builtins.auto_improvement.*` (`spine/driver.py:1579`, `spine/agent_runner.py:1368-1379`) | Relative imports | Hook files load into a synthetic package named after the app (App Kit `manifest-reference.md`, "Importing your own modules"). |
| 121 `from kiro_crew... import ...` statements across 30 modules | `name = _host.need("<module>", "<name>")` where the built-in bound the name at import, `_host.require(...)` where it imported inside a function | See "Gateway services with no App Kit seam" below. A test that patches a name on the app's module still reaches it, exactly as before. |
| `_redact_activity` returned a dict or list verbatim when the redactor could not be imported (`backend/runner.py:407-410`, pinned as a known defect by `test/test_ai_runner_coverage.py`) | It recurses and replaces each string leaf with the placeholder | A fail-open on an egress path (`GET /run`): fixed, and the test now pins the fail-closed behaviour. |
| `iconUrl` / `heroImage*` as `/app-assets/auto-improvement/*.svg`, `screenshots` `/app-assets/…` (`app.json:76-89`) | `iconPath` / `heroImage*` / `screenshots` as repo-relative PNGs under `assets/` | A registry app's art is repo-relative, and the catalog's publish step refuses SVG for a non-builtin source. The PNGs were rendered from the built-in SVGs (kept beside them): the icon at 512×512 on an opaque tile with `--ico-a` / `--ico-b` resolved to fixed colours, the heroes at 1200×675 and the detail heroes at 1200×288. The store screenshot is the README's light hero. |
| `ui.pages` `[{"route": "/auto-improvement", "label": "Auto-Improve", "icon": "Brain"}]`, page compiled into the dashboard (`app.json:67-75`, `website/src/apps/builtinRegistry.ts:60`) | `ui.entry: "dist/index.mjs"` (a committed ESM bundle built from `ui/src/`), `ui.pages` `[{"route": "/apps/auto-improvement", "label": "Auto-Improve"}]`, no `icon` | An installed app ships its page as a bundle AppHost loads. The legacy `/auto-improvement` route and `Brain` glyph of an adopted record come from Kiro Crew's adoption pin, never from this manifest. |
| App Store copy keys in the dashboard catalogs (`website/src/components/appstore/appManifest.ts:84-98`) | `l10n` block in `app.json` for the 11 non-English locales | The listing copy travels with the app. It is the `apps.autoImprovement.manifest` subtree of `ui/i18n/<locale>.json`, kept equal by a test. |
| No `minKiroCrewVersion`, no `license` | `"minKiroCrewVersion": "0.13.0"`, `"license": "Apache-2.0"` | The first Kiro Crew release line with App Kit level 1 (structural route records, `ctx.require_owner`). A 0.12.x gateway's registry skips every record that is not its own `AppRoute`, so every route would answer 404 there. The licence is the repository's. |
| Loggers named for `kiro_crew.apps.builtins.auto_improvement.*` | `__name__` under the gateway's loader (`_kirocrew_app_auto-improvement.<module>`), plus `kirocrew.app.auto-improvement` for the hooks and the shim | Hook files load into a synthetic package. An operator filter on the old names needs the new ones. |

## Gateway services with no App Kit seam: resolved from the gateway, fail closed

Nothing in `backend/`, `spine/` or `profiles/` but `backend/_host.py` names
`kiro_crew`, and `_host.py` has no `import kiro_crew` statement: every host name goes
through `_host._host_attr` (`importlib`), so a missing one never breaks the load
(`tests/test_no_host_imports.py`). The app uses three seams of App Kit level 1 —
`ctx.require_owner`, `ctx.data_dir` and `ctx.sdk_level` (read with `getattr`, with
`ctx.http_app` and `ctx.health`) — plus `ctx.lifecycle` of level 2 when the gateway has
it, and no `ctx.embed`, because the app embeds nothing.

Everything else it needs is a gateway internal. Where the built-in bound a name at
import, `_host.need` binds the gateway's own object, or, when the gateway has none, a
stand-in that REFUSES every use (calling it, reading an attribute, iterating, entering
it raises `HostCapabilityMissing`, an `ImportError`) and is falsy; a pure constant
falls back to the host's current literal (`_host._LITERALS`, each checked against the
pinned host by `tests/test_host_seams.py`), and an exception class to a
`HostCapabilityMissing` subclass. Where the built-in imported inside a function,
`_host.require` raises `HostCapabilityMissing` there, so the function's own
`try`/`except ImportError` (or `except Exception`) is its fail-closed branch, as it was.
A missing sandbox therefore never becomes an unsandboxed spawn, a missing redactor never
becomes unredacted text, and a missing tool gate never becomes an approved tool call.
`register_routes` reports every missing name through `ctx.health`
(`_host.capability_issues`).

| Kiro Crew module | Names | Built-in call sites | What it does for the app | Without it | Seam Kiro Crew needs |
|---|---|---|---|---|---|
| `kiro_crew` | `_facade_mirror`, `agent`, `platform_compat` | `backend/deps.py:24` `profiles/github_repo/profile.py:83` `spine/agent_runner.py:45` `spine/agent_runner.py:772` `spine/driver.py:44` | `_facade_mirror` keeps the `spine.driver` / `spine.agent_runner` facades' patch seams whole; `agent` (the shared agents-spec lock and foreign-spec decision); `platform_compat` (the platform helper module) | `driver` / `agent_runner` refuse to load (an import-time stand-in that refuses); no agent self-registration; no platform helpers (every caller refuses) | `platform_compat` is the module App Kit already names for platform decisions (`docs/app-kit/manifest-reference.md`); the facade mirror is a pure helper an SDK could export; an agent-spec install seam for an app's own agents |
| `kiro_crew.acp` | (the module) | `backend/pr_watchers.py:929` `backend/runner.py:614` | imported for its side effect before the provider factory is built | no agent run (`require_module` raises) | an app-scoped agent-session API (below) |
| `kiro_crew.acp.types` | `EVENT_COMPLETE`, `EVENT_PERMISSION_REQUEST`, `EVENT_TEXT_CHUNK`, `EVENT_TOOL_CALL`, `EVENT_TOOL_CALL_UPDATE`, `STOP_REASON_STALE_RECOVER` | `spine/agent_runner.py:893` | ACP event names the runner switches on | the host's current literals (`_host._LITERALS`) | none: names, not policy |
| `kiro_crew.agent_discovery` | `_read_agent_spec`, `list_agents`, `served_provider_label`, `spec_str` | `spine/crew_runner.py:9` `spine/crew_runner.py:90` | read a member's agent spec and its served provider label | no member run | an app-scoped crew-member runtime |
| `kiro_crew.agent_sdk.kas_floor_wait` | `wait_kas_floor_verdict_blocking` | `spine/agent_runner.py:830` | wait for the gateway's KAS floor verdict before a config load on the runner's own thread | no agent run | part of the agent-session API |
| `kiro_crew.agent_sdk.native_allow_stores` | `home_leaves` | `profiles/github_repo/profile.py:293` | the credential stores a measurement child must not see | no measurement (refused) | a sensitive-path predicate on the context |
| `kiro_crew.agent_spec_format` | `is_agent_spec_name`, `is_markdown_spec`, `spec_stem` | `spine/crew_runner.py:10` | spec-name rules for the crew runner's project-shadow refusal | no member run | part of the crew-member runtime |
| `kiro_crew.apps` | `teardown` | `backend/routes.py:26` | `teardown.register_app_disable_hook` | not used: `on_shutdown` replaces it | none |
| `kiro_crew.apps.manager` | `app_data_dir`, `app_lifecycle_lock`, `is_app_enabled` | `backend/routes.py:27` `backend/store.py:31` | `app_data_dir` (only for the stdio MCP server, which has no context); `app_lifecycle_lock` and `is_app_enabled` (the run-start admission that disable races) only on a gateway below App Kit level 2, bound by `_host.fallback`, which records no gap when they are gone: a level-2 gateway admits through `ctx.lifecycle.admit` | the MCP server has no data root (its tools refuse); with neither `ctx.lifecycle` nor the lock a run start is refused (reported through `ctx.health`) | the data directory as an environment variable for an app's own child processes; the lifecycle read is `ctx.lifecycle` (#32648) |
| `kiro_crew.atomic_write` | `atomic_write`, `read_json_or`, `replace_with_retry` | `backend/store.py:32` `spine/archive.py:33` `spine/git_safety.py:76` | `atomic_write`, `read_json_or`, `replace_with_retry` (Windows sharing-violation retries) | every read and write of the app's files refuses | a public file helper in the SDK |
| `kiro_crew.config` | `KiroCrewConfig` | `backend/crew.py:11` `backend/runner.py:218` `spine/agent_runner.py:46` `spine/agent_runner_gate.py:24` | `KiroCrewConfig.load()`: the provider factory, the hook config, the sandbox mode, members | no run, no member, no gate (refused) | part of the agent-session and crew-member APIs |
| `kiro_crew.config.loader` | `_session_work_dir`, `config_dir` | `profiles/github_repo/profile.py:1428` `spine/crew_runner.py:11` | `config_dir` (the data home the do-not-pollute fence covers) and `_session_work_dir` | no measurement, no member run | the data home path on the context; part of the crew-member runtime |
| `kiro_crew.config.paths` | `data_home`, `kiro_agents_dir`, `project_agents_dir` | `backend/clone_setup.py:31` `spine/agent_runner.py:773` `spine/crew_runner.py:12` | `data_home` (the quarantine root for refused clones), `kiro_agents_dir`, `project_agents_dir` | no clone setup; no agent self-registration; no member run | the data home on the context; an agent-spec install seam |
| `kiro_crew.config.sections` | `KiroCrewAgentConfig` | `backend/crew.py:12` | `KiroCrewAgentConfig`, the Scout and Engineer member records | no members (refused) | an app-owned crew-member API |
| `kiro_crew.constants` | `DENY_CAUSE_AUDIT_UNAVAILABLE`, `DENY_CAUSE_HOOK_ERROR`, `DENY_CAUSE_POLICY`, `DENY_CAUSE_SURFACE_POLICY` | `spine/agent_runner.py:47` `spine/agent_runner_gate.py:25` | the deny-cause codes the steer notice names | the host's current literals | none: codes, not policy |
| `kiro_crew.crew_avatar_seed` | `default_icon_avatar` | `backend/crew.py:13` | the name-seeded icon a new member is born with | no members | part of the crew-member API |
| `kiro_crew.dashboard.crash_dump_store` | `current_process_identity`, `pid_identity_alive` | `backend/runner.py:48` | `current_process_identity` / `pid_identity_alive`: is the process that owned a run record still alive | a run record cannot be judged interrupted (status refuses) | a process-identity helper in the SDK |
| `kiro_crew.dashboard.handlers` | `source_providers` | `backend/pr_checks.py:187` | `source_providers.fetch_pull_request{,_checks}`, the gateway's own GitHub client | no PR status (the page shows Unavailable) | a source-provider read API on the context |
| `kiro_crew.dashboard.handlers._shared` | `require_owner_dashboard_request` | `backend/routes.py:28` | `require_owner_dashboard_request` | not used: `ctx.require_owner` (level 1) replaces it | none |
| `kiro_crew.execution_context` | `bind_session_execution`, `member_config_for_id`, `resolve_member_execution` | `backend/crew.py:14` `spine/crew_runner.py:13` | resolve and bind a member's execution identity for its session | no member run | part of the crew-member runtime |
| `kiro_crew.git_config_hooks` | `ConfigHookScanError`, `config_hook_disable_args` | `spine/git_safety.py:77` | disable `hook.<name>.command` config hooks on every host-side git call over an agent-writable tree | no host-side git (every call refuses); the scan error stays catchable | a hardened host-git helper in the SDK |
| `kiro_crew.git_tmp_packs` | `reap_stale_tmp_packs` | `backend/clone_setup.py:32` `backend/commit.py:23` `spine/driver_publish.py:24` | reap the `tmp_pack_*` a killed fetch leaves | the fetch that needs it refuses | part of the hardened host-git helper |
| `kiro_crew.history` | `ConversationLog` | `spine/crew_runner.py:14` | `ConversationLog`, a member session's transcript | no member run | part of the crew-member runtime |
| `kiro_crew.hooks` | `HOOK_REPLY`, `HookManager`, `TOOL_DENY`, `hook_gate_kwargs`, `hooks_config_from_config_dict` | `spine/agent_runner.py:53` `spine/agent_runner_gate.py:26` `spine/crew_runner.py:15` | the gateway's PreToolUse `HookManager` and its config, so every tool call the unattended runner approves passes the gateway's own gate | no agent run (a tool call cannot be gated, so none is approved) | a tool-gate API on the context |
| `kiro_crew.json_line` | `parse_json_object_line`, `recover_line_id` | `backend/mcp_server.py:25` `spine/agent_runner.py:59` | the line-delimited JSON reader contract (stdio MCP server, agent stream) | no MCP server; no agent stream | none needed: pure, could be restated |
| `kiro_crew.llm_helpers` | `_extract_json_of_type`, `_steer_host_deny` | `spine/agent_discovery.py:58` `spine/agent_runner.py:60` | `_extract_json_of_type` (parse a model's JSON answer) and `_steer_host_deny` (the in-band deny notice) | no discovery parse; no steer (a deny is still a deny) | the steer-notice helper on the agent-session API |
| `kiro_crew.member_workspace` | `AUTO_WORKSPACE`, `provision_member_workspace`, `retire_unpublished_workspace` | `backend/crew.py:15` | provision and retire a member's workspace | no members | part of the crew-member API |
| `kiro_crew.members` | `record_activity` | `spine/crew_runner.py:16` | `record_activity` on the member roster | no member run | part of the crew-member API |
| `kiro_crew.memory_stores` | `persist_member_config`, `provision_member_memory`, `require_member_memory_store`, `retire_unpublished_allocation` | `backend/crew.py:20` | provision, persist and retire a member's private memory store | no members | part of the crew-member API |
| `kiro_crew.owner_only_files` | `ensure_directory`, `mkdirs_owner_only`, `owner_only_opener_for`, `write_text_owner_only_in_home` | `backend/clone_setup.py:33` `backend/ledger_admin.py:48` `backend/store.py:119` `backend/store.py:127` `backend/store.py:158` `spine/agent_discovery.py:59` `spine/archive.py:34` `spine/ledger.py:29` | `0700`/`0600` files and directories inside the data home, the host's symlink refusals | every write of the app's files refuses | a public file helper in the SDK |
| `kiro_crew.permission_floor` | `OUTCOME_PENDING_APPROVAL`, `OUTCOME_REJECTED_TRANSPORT_FLOOR` | `spine/agent_runner.py:61` | the transport-floor outcome codes | the host's current literals | none: codes, not policy |
| `kiro_crew.platform.context` | `redact_log_via_context`, `redact_via_context` | `backend/clone_setup.py:34` `backend/commit.py:24` `backend/pr_watchers.py:62` `profiles/github_repo/pr_recipe.py:46` `profiles/github_repo/profile.py:84` `spine/agent_runner.py:65` `spine/crew_runner.py:17` `spine/driver.py:45` `spine/driver_commit.py:25` `spine/driver_publish.py:25` `spine/gate.py:36` | `redact_via_context` / `redact_log_via_context`: the active platform context's redaction (enterprise policy on top of the baseline) | every redaction refuses, so the text is withheld | `ctx.scrub` covers the in-gateway hooks; the worker threads and the stdio server need the same scrubber outside a request |
| `kiro_crew.platform.update_governance` | `nested_repo_exec_driver_reason` | `spine/git_safety.py:78` | `nested_repo_exec_driver_reason`: refuse a nested repository's exec drivers | no host-side git (refused) | part of the hardened host-git helper |
| `kiro_crew.platform_compat` | `IS_WINDOWS`, `SIGKILL`, `first_linked_ancestor`, `is_link_or_junction`, `kill_process_tree`, `rmtree_force` | `backend/clone_setup.py:35` `backend/pr_watchers.py:63` `spine/agent_runner.py:66` `spine/driver_commit.py:338` `spine/gate.py:37` `spine/pollute.py:45` | `IS_WINDOWS`, `SIGKILL` (literals), `first_linked_ancestor`, `is_link_or_junction`, `kill_process_tree`, `rmtree_force` | the literals fall back; the helpers refuse | none: App Kit names `platform_compat` as the module apps route platform decisions through |
| `kiro_crew.sandbox` | `LAUNCHER_EXIT_PREFIXES`, `_LAUNCHER_SCRIPT_SUFFIX`, `_SANDBOX_ARTIFACT_PREFIX`, `effective_sandbox_mode`, `popen_limited`, `run_limited`, `sandboxed_spawn_argv` | `backend/clone_setup.py:41` `backend/runner.py:219` `profiles/github_repo/profile.py:85` `spine/agent_runner.py:67` | `sandboxed_spawn_argv`, `popen_limited`, `run_limited` (every agent, git and measurement child in the gateway's OS sandbox), `effective_sandbox_mode`, and the launcher's refusal prefixes and file-name affixes | no child process at all (never an unsandboxed one); the affixes fall back to the host's literals | an app-scoped sandboxed subprocess on the context |
| `kiro_crew.sandbox_spawn` | `scrub_env` | `backend/deps.py:25` | `scrub_env`, the credential scrub of a child's environment | no dependency install (refused) | part of the sandboxed-subprocess seam |
| `kiro_crew.security` | `redact`, `redact_and_truncate`, `redact_credentials`, `redact_exfiltration_urls`, `write_protected_home_paths` | `backend/commit.py:25` `backend/deps.py:26` `backend/mcp_server.py:26` `backend/pr_watchers.py:1615` `backend/routes.py:29` `backend/runner.py:408` `profiles/github_repo/pr_recipe.py:116` `profiles/github_repo/profile.py:294` `spine/agent_runner.py:644` `spine/driver_commit.py:110` `spine/push_policy.py:204` | `redact`, `redact_and_truncate`, `redact_credentials`, `redact_exfiltration_urls`, `write_protected_home_paths` | every redaction refuses and its text is withheld; a push is refused as unscannable; no measurement | `ctx.scrub` in the hooks; a scrubber reachable from the app's own threads and child processes |
| `kiro_crew.sel` | `sel` | `backend/mcp_server.py:27` `backend/routes.py:1402` `backend/routes.py:1432` `spine/agent_runner.py:177` `spine/agent_runner.py:650` `spine/agent_runner.py:1232` `spine/agent_runner.py:1278` | `sel()`: the Security Event Log rows the built-in wrote (owner-route allows, agent approvals, MCP tool calls) | the audit write fails, and an approval that requires its row is refused | `ctx.audit` covers in-gateway rows; the stdio server and the runner threads need the same sink |
| `kiro_crew.shared_crew.admission` | `OperationKind` | `spine/crew_runner.py:163` | `OperationKind` for shared-crew turn admission | no member run | part of the crew-member runtime |
| `kiro_crew.shared_crew.turn_gate` | `run_admitted_or_raise` | `spine/crew_runner.py:164` | `run_admitted_or_raise`: a member turn is admitted like every other turn | no member run | part of the crew-member runtime |
| `kiro_crew.subprocess_utf8` | `UTF8_TEXT` | `backend/clone_setup.py:46` `backend/deps.py:27` `backend/pr_watchers.py:64` `profiles/github_repo/pr_recipe.py:47` `spine/agent_discovery.py:60` `spine/agent_runner.py:68` `spine/agent_runner_authoring.py:24` `spine/driver.py:46` `spine/driver_publish.py:26` `spine/gate.py:38` `spine/proposer.py:29` `spine/scope.py:26` | `UTF8_TEXT`, the UTF-8 subprocess keywords | the host's current literal | none: a literal |
| `kiro_crew.user_json` | `loads_user_json` | `backend/crew.py:26` | `loads_user_json`, the BOM-tolerant reader for `crew.json` | no member roster read | none needed: pure |
| `kiro_crew.validation` | `validate_mcp_tool_arguments` | `backend/mcp_server.py:312` | `validate_mcp_tool_arguments` for the stdio server's tool calls | the call is refused | none needed: pure |
| `kiro_crew.workflows.registry` | `_await_owned` | `backend/crew.py:27` `spine/crew_runner.py:18` | `_await_owned`, the gateway's owned-task wait | no member run; startup refuses | none needed: a small asyncio helper |

The redaction and audit rows deserve a note. `ctx.scrub` and `ctx.audit` are App Kit
level-0 seams, and the hooks could use them. They are not used, deliberately: the same
redaction runs in the run supervisor's worker thread, the PR watchers' threads and the
stdio MCP server's own process, none of which has a context, and the audit rows keep the
built-in's caller and operation names, which an operator's existing SEL queries read.
One redactor and one audit sink for every path is what the built-in had; splitting them
between a seam and the host's internals would be two policies.

## Remaining gaps

1. **The private names above.** Each is a module a Kiro Crew refactor can move. The
   stand-ins keep that failure closed and reported (`ctx.health`), but the part of the
   app that needs the name stops working until the name is back or a seam replaces it.
   The seams that would retire most of them: an app-scoped sandboxed subprocess, an
   app-owned crew-member and agent-session API with the gateway's tool gate and
   transport floor, a scrubber and an audit sink reachable from an app's own threads
   and child processes, and a public file helper.
2. **The MCP server's own-tool auto-approve after adoption.** Adoption now carries the
   app's stdio MCP server (#32637, E10 in `docs/system-specs/modules/app-kit-platform.md`):
   this tree starts it with a bare `python3` and `backend/mcp_launch.py`, the shape the
   gateway anchors to the adopted root, with the built-in's server key, its six
   `autoApprove` tools and no `env`, and Kiro Crew's own check accepts it
   (`tests/test_manifest_contract.py::test_adoption_carries_the_server_from_this_tree`).
   What adoption does not yet carry is the tool gate's trust in an app's OWN server:
   it reads the built-in installs only (`execution.builtin_app_mcp_servers`), so after
   adoption this server's six read-only tools would start asking for approval on a
   governed host and on a harness that relies on the PreToolUse gate. Kiro Crew pins
   that with `test_no_shipped_pin_names_a_built_in_that_ships_an_mcp_server`, so **the
   adoption pin for `auto-improvement` must not be added until the core change that
   carries that trust to an adopted record merges** (in flight as
   `fix/adopted-app-own-mcp-autoapprove`) and removes that pin.
3. **Core still names the app.** `apps/builtins/__init__.py:4` (`BUILTIN_NAMES`),
   `security_posture.py:583-612` and `security_posture_sinks_gateway.py:628-738`
   (posture rows naming the built-in's files), `sandbox_leaves.py:174-182` and
   `security/paths_lists.py:263` (the `quarantined-clones` leaf, which this copy still
   writes), `sandbox_unavailable.py:824`, `apps/execution.py:109`,
   `skill_runtime/catalog.py:68`, `members_parts/member_activity.py:65`,
   `dashboard/handlers/members_drawer.py:228`, `docs/apps.md:59`, the spec
   `docs/system-specs/modules/auto-improvement.md`, the dashboard's
   `website/src/apps/builtinRegistry.ts:60`, `components/appstore/appManifest.ts:84`,
   `utils/seedReceipt.ts:4`, `api/client/agents.ts:147`, the catalog keys, and the
   ratchet rows in Kiro Crew's tests (`test/spawn_audit_app_spawns.py`,
   `test/link_screen_sites.py:63-70`, `test/test_hooks.py:873-1114`,
   `test/test_transport_permission_floor.py:802`,
   `test/test_reconcile_sandbox_tool_exclusion.py:60`,
   `test/test_agent_spec_hardened_reads.py:1087`,
   `test/test_internal_python_isolation.py:27`, `test/test_link_screen_hold_pin.py:184`,
   `test/windows-expected-failures.txt`, `test/requires-real-symlinks.txt`). They go
   when the built-in does. The member-activity `via` value `auto-improvement` and the
   `quarantined-clones` leaf need generic replacements (an app-declared activity source,
   an app-declared hidden data leaf) before then.
4. **Execution trust.** A built-in's in-gateway Python is exempt from the third-party
   execution gate (`apps/execution.py`, `is_builtin_app`). This copy's hooks load only
   when the operator trusts it (`agent.apps_trusted`, or `agent.apps_allow_third_party`).
   For an existing user, Kiro Crew's adoption writes that grant for this repository; a
   fresh install goes through the normal trust dialog.
5. **Run-start admission (closed on App Kit level 2).** The built-in admitted a run
   under the app's lifecycle lock after reading the enabled flag
   (`backend/routes.py:1493-1513`), so a disable racing the start either sees the app
   off or stops the run it admitted. On a level-2 gateway the app asks
   `ctx.lifecycle.admit` for exactly that, with the supervisor's stop count as its
   check, and touches no private name; a timed-out admission is a retryable `409`
   `app_busy`. Only a gateway below level 2 still goes through
   `apps.manager.app_lifecycle_lock` / `is_app_enabled`
   (`tests/test_run_start_admission.py`).
6. **Agent self-registration.** The discovery runner writes its own agent spec into the
   kiro-cli agents directory under the shared agents-spec lock
   (`spine/agent_runner.py:744-788`); an agent-spec install seam would replace the
   `agent` module calls.
7. **Styles.** The page keeps the built-in's Tailwind utility class strings. They render
   because the dashboard's stylesheet still carries them while the compiled built-in
   page ships with Kiro Crew.
8. **Store listing localization.** The catalog's publish step does not carry `l10n` yet,
   so a store row that is not installed shows the English fields.
9. **Sidebar icon on a fresh install.** The `Brain` glyph and the `/auto-improvement`
   route are shown only for an adopted record (from Kiro Crew's pin). A fresh install
   lives at `/apps/auto-improvement` with the `iconPath` image.
10. **The session's folder row.** The built-in asked the sidebar to expand the app's
    chat folder after opening a session (`requestSlotFolderOpen`,
    `lib/agentSession.ts:283`). The App Kit's chat launcher opens the session but has no
    such call, so a collapsed `Auto-Improve - <repo>` folder stays collapsed.
11. **Author.** `app.json` keeps `"author": "zedmor"`, the built-in's value.
12. **Opening a session the app just created.** `useChatLauncher().openChat({slotKey})`
    opens `/chat?sid=<key>`, and the dashboard's chat page keeps that `sid` only when
    its own session list already holds the slot. A slot this app created through
    `POST /api/chat/slots` moments earlier reaches that list through the gateway's
    create broadcast, so an immediate open lost the race on the capture gateway: the
    page dropped the `sid` and stayed on the previously active chat. The built-in
    never raced, because it switched the dashboard's store itself (`switchSlot`)
    before navigating. `lib/agentSession.ts` therefore waits a bounded 1.5 s
    (`sessionOpenTiming`) before opening a NEW session; a resumed one opens at once.
    The App Kit gives an app no "the host lists this slot" signal; a launcher that
    fetches an unknown `sid` (or a create call on the SDK that returns once the host
    lists the slot) would remove the wait. **Closed on App Kit level 2** (#32648): that
    host's chat page waits (up to 5 s) for its own list to show a slot the app just
    created before it opens it, so the page opens a new session at once when the host
    exports `APP_SDK_LEVEL >= 2` (`ui/src/hostSdk.ts`, `hostSdkLevel`); the 1.5 s wait
    is kept only below level 2.

## UI

The page is `ui/src/`, ported from `website/src/apps/auto-improvement/` with the same
markup, class strings and behaviour. `npm run build` in `ui/` writes the committed
`ui/dist/index.mjs`; CI rebuilds it and fails on a difference. Every request goes
through the host's scoped client (`useAppApi().raw`, handed to `setTransport` by the
root), so a path outside `permissions.api` is refused in the browser; the backend's
`error` sentence is read back out of the client's refusal. Strings are `t()` over
`ui/i18n/<locale>.json` for all 12 dashboard locales, under the dashboard's own key
paths, plural forms by `Intl.PluralRules`.

| Built-in | Here |
|---|---|
| bare `fetch('/api/apps/auto-improvement/...')` | `ui/src/api.ts` over the scoped client |
| `components/ui` `Badge`, `Btn`, `Card`, `CardTitle`, `Input`, `StatCard`; `components/Clickable` | The same components from `@kirocrew/app-sdk/ui` |
| `components/SimpleSelect` | `Select` from `@kirocrew/app-sdk/ui` (a native `<select>` on an older host, `ui/src/hostSdk.ts`) |
| `hooks/useImeGuard` | `useImeGuard` from `@kirocrew/app-sdk` |
| `i18n/t.i18nT`, `i18n/format.fmtDateFields` | `ui/src/i18n.ts` over the app's own catalogs (`fmtDateFields` reads the host's active locale) |
| `store/chatSlice` `createSlot`, `deleteSlot`, `switchSlot`, `requestSlotFolderOpen` and `api.chatFolders` / `createChatFolder` / `chatSlotDetail` (`lib/agentSession.ts:24-30`) | `ui/src/host/chat.ts`: the same `POST /api/chat/slots`, `DELETE /api/chat/slots/<key>`, `GET /api/chat/slots/<key>?limit=1`, `GET`/`POST /api/chat/folders` over the scoped client; the session is opened with `useChatLauncher().openChat({slotKey})`; no folder expand (gap 10) |
| `chat-core/transport/sendTurn` | `ui/src/host/sendTurn.ts`, the receipt contract restated, over a wire that posts `/api/chat?ws=1` through the scoped client |
| `utils/seedReceipt.settleSeedReceipt`, `utils/thunkError.isMissingSlotError` | `ui/src/host/seedReceipt.ts`, `ui/src/host/chat.ts`, the same rules |
| `utils/ensureChatFolder`, `utils/sha256Hex` | `ui/src/host/ensureChatFolder.ts`, `ui/src/host/sha256Hex.ts`, unchanged |
| `react-router-dom` `useNavigate('/chat')` | the chat launcher navigates; below App Kit level 2, after a bounded wait for a new session (gap 12) |
| `autoImprovement.rulerNotReady`: "The ruler is not calibrated yet, so no improvement cycle will run." | "The ruler is not calibrated yet. It is only used to judge speed-ups; the runs started from this page fix bugs, and the repository's tests judge each fix instead." in all 12 locales. The old sentence was false: a run started from the page is a bug-track run (`track` is not writable through `PUT /config`), which skips the ruler (`spine/driver.py`, `run`), and nothing on the page writes the `ruler.json` the card reads |
| `autoImprovement.intro`: "Measures a repository before it changes it: the metric is calibrated and proved first, ..." | "Fixes bugs in a repository and keeps only what its tests prove ..." in all 12 locales. The old wording described a perf-track run; a run started from the page is a bug-track run, which no ruler gates |

## Tests

`tests/` holds the built-in's own 54 test files and every Kiro Crew test whose subject
is this app; `ui/tests/` the page's. They run offline: Kiro Crew is a pinned test
dependency (`tests/requirements.txt`, one commit of its public source), so the sandbox,
the hook manager, the members, the redactor and the file helpers are the real ones.

| Built-in test | Here | Change |
|---|---|---|
| `src/kiro_crew/apps/builtins/auto_improvement/tests/*` | `tests/`, same names | Module paths are `auto_improvement.*` (the root `conftest.py` registers the app root as that package, as the gateway registers it under its own name). `tests/conftest.py` keeps the built-in's fixtures and adds the floor Kiro Crew's rootdir conftest gave them: the data home pinned per test (`_isolated_kirocrew_home`), `_floor_monkeypatch`, the git maintenance floor, and the host's own `AppContext` bound for every test (`bound_ctx`). |
| `test_disable_stops_run.py`, `test_shutdown_stops_run.py`, `test_run_start_honors_stop.py` | same | The disable and shutdown paths are `hooks.on_shutdown`; the routes are mounted through `tests/harness.py`, which serves `register_routes(ctx)` the way the registry does. |
| `test_finding_detail.py`, `test_metric_design_skill.py`, `test_runner.py` | same | Routes mounted through the harness; the skill's route claim reads the route table. |
| `test/test_ai_backend_routes_coverage.py` | `tests/` | The `_require_enabled` and `app.on_startup` / `on_cleanup` cases become the registry's enabled gate and the three hooks. |
| `test/test_ai_runner_coverage.py` | `tests/` | `test_import_failure_fails_OPEN_for_containers_known_defect` pinned a defect; the port fixes it and the test pins fail-closed. |
| `test/test_ai_agent_discovery_helpers.py` | `tests/` | "The real repository" is this one (a flat layout, `.`); the diag-log test compares before and after, since the floor makes its own directories. |
| `test/test_agent_runner_owner_bindings.py`, `test/test_driver_owner_bindings.py` | `tests/` | The scans read this repository (`tests/app_corpus.py`) instead of `test/source_corpus.py`; a `_host` binding is an import, not a definition; the app-loader probes load this tree. Dropped: `test_leaf_test_scope_derives_this_file_as_a_corpus_gate`, which reads Kiro Crew's `scripts/leaf_test_scope.py`. |
| `test/test_pr_recipe.py` scanner cases | `tests/` | The "no security module" double is the gateway lacking `kiro_crew.security`, as the shim resolves it. |
| Every other `test/test_ai_*`, `test_auto_improvement_*`, `test_bug_*`, `test_spine_json_extraction.py` | `tests/` | Import paths; `from conftest import ...` helpers come from `tests/symlink_capability.py`; Kiro Crew test helpers they import (`facade_mirror_scan.py`, `git_maintenance_helpers.py`, `stray_line_helpers.py`, `windows_sim.py`) are copied beside them. |
| The auto-improvement cases of `test/test_owner_gate_round10_misc.py`, `test_git_tree_removal_windows.py`, `test_git_config_hooks.py`, `test_windows_replace_retry_sweep.py`, `test_owner_only_files.py`, `test_sandbox_launcher_refusal.py`, `test_sandbox_launcher_import_hoist.py`, `test_git_tmp_packs.py`, `test_env_allowlist_consolidation.py`, `test_handlers_auto_improvement_deny_notice.py` | `tests/test_deps_install_owner_gate.py`, `test_git_tree_removal_windows.py`, `test_git_safety_config_hooks.py`, `test_store_replace_retry.py`, `test_run_archive_owner_only.py`, `test_launcher_parity.py` (both launcher suites, with `sandbox_launcher_helpers.py`), `test_fetch_timeout_reaps_tmp_packs.py`, `test_measure_env_allowlist.py`, `test_agent_runner_deny_notice.py` | The app's cases only; the core halves stay in Kiro Crew. |
| (none) | `tests/test_host_seams.py`, `tests/test_no_host_imports.py`, `tests/test_manifest_contract.py` | Every fail-closed path of the shim, the capability report, the owner gate, the data root, the hooks, the MCP launcher; only the shim reaches `kiro_crew`; manifest parity, the bundle's imports, the hooks loading through the gateway's own module loader and serving a request through its `RouteRegistry`, no hardcoded model id, an adoptable tree, the MCP server accepted by Kiro Crew's own adoption check. |
| (none) | `tests/test_run_start_admission.py` | Run start through `ctx.lifecycle.admit` (admitted, disabled, timed out, the host's real `AppLifecycleSDK`), never the private names on a level-2 gateway; the refusal and the capability report on a gateway with neither. |
| `website/src/apps/auto-improvement/*.test.tsx`, `website/src/test/autoImprovement*.test.ts(x)` | `ui/tests/` | No Redux store or router; requests go through the stub host client (`ui/tests/stubs/`). |
| The auto-improvement halves of `website/src/test/agentSessionFolderResolve.test.ts` and `agentSessionSeedReceipt.test.ts` | `ui/tests/agentSession.test.ts` | Against `ui/src/host/chat.ts`, plus resume. The folder-expand cases are gone with the call (gap 10). |
| (none) | `ui/tests/externalSeams.test.tsx` | The chat endpoints' requests, the refusal mapping, the seed wire, catalog coverage and fallback, the host `Select`. |

Kiro Crew tests that use `auto-improvement` only as a sample app name, slot key or
member source (`test_mate_chat_agent_resolution.py`, `test_mcp_apply.py`,
`test_ws_event_scoping.py`, `test_skill_browser_containment.py`,
`test_legacy_member_session_backfill.py`, `test_skills.py`,
`test_chat_slot_mutes_opened_provenance.py`, `test_mate_config_migration.py`,
`test_runtime_death_is_a_process_event.py`), and `test_kas_cli_floor.py`'s
off-loop-runner case, whose subject is Kiro Crew's KAS floor, stay in Kiro Crew with a
neutral fixture when the built-in leaves.

## What Kiro Crew keeps doing

The release that adds adoption still ships the built-in. A user's built-in record moves
onto this repository at the commit Kiro Crew pins, on the restart after the tree is
fetched and verified; a record that cannot move keeps running the built-in copy,
unchanged. For this app the pin waits on gap 2 (the tool gate's own-server trust for an
adopted record).

## Release handoff: one commit for both pins

The adoption pin and the catalog row must name the same commit, and that commit must be
the ported tree.

1. Call the full 40-hex SHA of this repository's `main` `C` (`git rev-parse HEAD`).
2. In the Kiro Crew release PR that adds adoption, once gap 2 is closed, run
   `python3 scripts/adoption_pin.py compute <this URL> C` and add the row it prints to
   `src/kiro_crew/apps/adoption-pins.json`; then `python3 scripts/adoption_pin.py verify`.
   Until that row exists the release adopts nothing, and the catalog row must not switch.
3. The KiroCrewApps row for `auto-improvement` switches to `"type": "git"`, this URL,
   `"ref": "C"`. Never a branch name or a placeholder.
4. Check that both files name the same `C`, and that GitHub serves it: in a fresh clone,
   `git fetch origin C` succeeds and `git cat-file -t C` prints `commit`.
5. The catalog PR stays a draft, labelled hold-for-release, until the Kiro Crew release
   that ships adoption and the App Kit level-1 seams is published.
