# pi-nobash stack companions: implementation-planning handoff

**Date:** 2026-10-11  
**Status:** Agreed direction and planning brief, **not** an implementation plan or authorization to merge code  
**Repository:** https://github.com/afshinator/pi-nobash  
**Primary implementation priority:** JavaScript/TypeScript (including Node/web and React Native/Expo), then Python  
**Secondary:** Rust and Go; evaluate existing Go quality server before implementing overlapping diagnostics

## 1. Decision summary

**D1 — Keep this work in the existing `pi-nobash` repository.** `docs/stacks/` is the official stack cookbook. Do not create a new repository at this stage.

**D2 — Move from documentation-only recipes to tested, working, opt-in companion extensions and copyable check configurations.** Provide real implementations for clearly necessary mutation operations, rather than asking every adopting developer to write all the common ones from scratch. Reference implementations can initially be copied into a developer's Pi project. Do not require separate npm packages or automatic stack provisioning yet.

**D3 — Preserve the shipped core boundary.** `pi-nobash` remains the small, reusable, opt-in no-general-execution capability foundation. Stack companions are separate, individually selectable Pi extensions; installing/loading core must **not** automatically expose them. Continue to use Pi native tool selection, not a second profile/permission system.

**D4 — Include `git_push` in P0**, alongside `git_create_branch`, `git_add`, and `git_commit`, but treat it as an explicit, separately selectable remote mutation with a narrowly defined contract. Its priority does **not** imply force-push, arbitrary refspec, or unrestricted remote configuration.

**D5 — Prioritize JS/TS and Python implementations.** Implement shared Git functionality and stack-specific formatters first; follow with scoped lint fixes and package/dependency mutations. Keep Rust and Go documented, but do not let those stacks delay delivery of JS/TS and Python.

**D6 — Preserve explicit gaps.** If a selected tool cannot express the operation, report `CAPABILITY_GAP`. No shell, interpreter, generic runner, ad-hoc model-authored arguments, or executing model-written scripts as a fallback.

**D7 — Publish real, copyable `.pi/pi-nobash.json` templates.** These remain developer-owned *configuration*, not tools and not auto-installed global defaults. Document variant-specific requirements and replace placeholders before use.

## 2. Product intent and non-goals

The aim is to prevent accidental damage from an otherwise well-intentioned coding agent given broad shell access. The agent chooses a named operation and bounded typed inputs; trusted implementation code owns how the operation is executed. The project is **not** an adversarial-bypass product, host sandbox, general security policy engine, agent orchestrator, or universal replacement for every Bash use.

Exactly three developer levers remain:

1. **Select tools:** Pi's `--tools`, `.pi/settings.json` `defaultTools`, and SDK/session tool selection.
2. **Configure named validation:** developer-owned `.pi/pi-nobash.json` defines fixed checks for core `run_validation`. The model chooses a check name, never an executable/argv/script.
3. **Add extensions:** developer installs/selects narrow typed mutation tools as separate Pi extensions. This handoff proposes offering maintained example implementations of those extensions in the repo.

Native Pi tools remain the first option for read, grep, find, ls, edit, and write. Existing packaged `json_query`, `query_jsonl`, `git_status`, `git_diff`, `git_log`, `git_show`, and `run_validation` are not to be gratuitously duplicated.

## 3. Scope and priorities for planning

The following priorities are decisions about order, **not** a complete signed-off API specification.

| Priority | Work | Stack(s) | Planning notes |
|---|---|---|---|
| **P0** | `git_create_branch`, `git_add`, `git_commit`, **`git_push`** | Shared | Individual tools, explicit branch/paths/remote behavior. Stage by selected paths; evaluate separately whether tracked-only or all-file staging modes should be offered. Push is normal non-force push only in the initial proposal. |
| **P0** | `js_format_write` | JS/TS, Node/web, Expo | Named formatter and explicit scope. Use established project tooling; do not expose arbitrary formatter executable/flags. |
| **P0** | `py_format_write` | Python | Same scoped behavior; decide on Ruff formatter and supported config discovery based on repo conventions. |
| **P0** | Real named-validation JSON templates | JS/TS, Python | Provide ready-to-copy `.pi/pi-nobash.json` variants derived from `docs/stacks/`. These are checks, **not** mutation implementations. |
| **P1** | `js_lint_fix`, `py_lint_fix` | JS/TS, Python | Bounded named-file fixes; review safe/unsafe modes separately. Never run `--fix` via `run_validation`. |
| **P1** | `js_dep_add`, `js_dep_remove`, `expo_dep_add` | Node/web, Expo | Enumerated package manager and dependency class as appropriate, strict package input checks; separate Expo-aware installation path. Do not let the model supply arbitrary CLI flags. |
| **P1** | `py_dep_add`, `py_dep_remove` | Python | Plan uv/Poetry/pipenv variants only if semantics can be made reliable; begin with one well-supported workflow. |
| **P2** | `fs_copy`, `fs_move` | Shared | Narrow workspace-scoped lifecycle actions only when demonstrated need exists. |
| **P2** | `git_rm_cached` | Shared | Index-only operation; preserve working-tree content. |
| **P2** | `fs_delete`, `rust_clippy_fix` | Shared/Rust | Defer. No unrestricted recursive deletion or implicit unsafe fixer. |
| **Later** | Rust formatter/dependencies, Go formatting/mod tidy/dependency tools | Rust/Go | Reassess after JS/TS and Python foundations and Go-reuse investigation. |

**Note on prior prioritization:** An earlier discussion placed `git_push` in P2; the current user decision explicitly moves it to **P0**. `git_rm_cached` stays P2.

### Git-specific planning guardrails

- Ensure branch creation, staging, committing, and pushing are distinct capabilities, not one unrestricted `git` command passthrough.
- `git_add` must not silently stage unrelated files. Document/implement explicit-path semantics first. Treat tracked-only and all-files staging as distinct, deliberately enabled modes, if implemented.
- `git_commit` must have defined behavior for the currently staged index; it must not auto-stage everything. Consider hooks and signing side effects, failure reporting, and conflicts.
- `git_push` must identify its remote/branch/upstream semantics without accepting arbitrary refspecs or flags; do not offer `--force`, `--force-with-lease`, tag deletion, wildcard pushes, or arbitrary remote URLs in the initial tool. Prefer a configured/validated remote and current branch, non-force push, no implicit remote creation. Surface rejected/non-fast-forward pushes as failures. Never claim pushing is harmless just because it is typed.
- Avoid accidental composition of operations: a push must not silently stage or commit.

### Language-specific planning guardrails

- Formatting and lint fixes are **mutations**; read-only `run_validation` checks may inspect/check but must not auto-write source files.
- Prefer explicit file targets, fixed developer-selected backends, bounded runtime/output, and clear changed-file results. Reject ambiguous/out-of-scope paths.
- Dependency commands can modify manifests/lockfiles and execute install lifecycle hooks. Evaluate exact side effects, default script behavior, network access, package validation, working-directory containment, and cancellation before implementing. Avoid claiming no-shell means no side effects.
- Do not manufacture a generic command execution route through package-manager scripts, custom entrypoint paths, user-provided flags, formatter plugins, or model-authored config.
- Do not widen core `run_validation` target support merely to make recipes appear working: **`node_test` is the only verified targeted test adapter**. Vitest/Jest/jest-expo/pytest/cargo/go use `targets.mode: "none"` unless separately implemented and verified.
- Tool names are global per session. Preserve `js_`, `py_`, `rust_`, `go_` prefixes for language-specific tools.

## 4. Repository organization and distribution

Suggested layout for the codebase agent to evaluate against actual conventions:

```text
pi-nobash/
  src/                         # existing packaged foundation
  extensions/                  # existing extension entry point
  companions/                  # proposed working, optional extension sources
    git/
    javascript/
    python/
    files/                      # if justified
    rust/                       # later
    go/                         # later / conditional
  docs/stacks/
    README.md
    typescript.md
    python.md
    rust-go.md
    examples/                  # proposed copyable check JSON variants, location TBD
  tests/
```

Do not interpret this tree as a mandatory path choice. The planning agent should inspect Pi's current extension registration/loading and npm packaging rules before finalizing. **Initially prefer maintained source/reference extensions and check templates over separate published packages.** Explicitly ensure companion sources are not automatically loaded or enabled when core is installed. Distinguish GitHub-visible files from files included in the npm tarball; root README links to `docs/stacks/` should stay absolute GitHub URLs.

Current `docs/stacks/` files are descriptions/recipes. Their language extensions (for example `my-js-tools.ts`) **do not currently exist** according to the user-provided directory inventory. After implementation, revise docs so each tool is visibly tagged implemented/reference vs proposed/unavailable; avoid presenting a described operation as shipped.

## 5. Stack adoption experience to target

A developer should be able to:

1. Read `docs/stacks/README.md` and a single language-specific guide.
2. Copy a working validation configuration appropriate to their package manager/test runner into the project's `.pi/pi-nobash.json`.
3. Install/copy only the companion extensions they need into their Pi environment/project.
4. Explicitly select native tools, core replacements, and companion tools for **each agent/session**.
5. Run named checks and typed mutations without ever offering the model a shell or equivalent general runner.
6. See a clear `CAPABILITY_GAP` for operations that remain unsupported.

Check examples must clearly identify assumptions (installed tooling, package manager, root directory, check scripts) and not imply that one JSON file works unchanged for all projects. Repository checks can have incidental side effects (build output, caches, test fixtures); the **configuration rule** is no intentionally mutating check commands such as `--fix`, `--write`, `git add`, or dependency mutations.

## 6. Go evaluation: `mcp-server-go-quality`

**Candidate:** https://github.com/afshinator/mcp-server-go-quality

**Preliminary conclusion: useful fit for a *Go diagnostics companion*, not a drop-in replacement for Go mutation tools and not grounds to broaden core.** Its public README describes:

- `run_code_checks` plus individual `run_lint`, `run_vuln_check`, and `run_nil_check` operations, combining golangci-lint, govulncheck, and nilaway.
- A unified sorted diagnostic schema with file/line/column, tool, severity where available, error, and native details.
- Parallel checker execution, timeouts, root/workspace discovery for `go.mod` and `go.work`.
- An `install_tools` capability that installs checker binaries, including versions described as `latest`, and configuration allowing `extra_args`.

These are **README-observed behaviors**, not an audit of the implementation or Pi compatibility. See the repo's README for source details.

**Recommended reuse path:** Investigate whether its diagnostic orchestration/parsing logic can be adapted behind a **Pi-native narrow typed extension** or connected as a tightly constrained existing service. Keep it optional and Go-specific. If comparable diagnostics can be delivered through developer-named `run_validation` checks with sufficiently useful output, avoid duplicating infrastructure without evidence of benefit.

**Required compatibility review before adoption:**

1. **Automatic installation:** Never expose `install_tools` as an ordinary read-only checker or silently install binaries. Installation is a separate mutation, developer-controlled and opt-in if used at all.
2. **Argument control:** Its developer-configured `extra_args` must not become model-supplied arbitrary argv. Review config ownership and whether an agent could edit config then invoke it, including session-load behavior.
3. **Fixed operations:** Model chooses only enumerated diagnostics/check subsets, project scope, and bounded inputs. No free-form process, command, CLI arguments, script, or executable path.
4. **Side effects:** Confirm whether individual checkers write caches, download vulnerability databases or tools, modify files, contact networks, or run project-controlled code. Label effects accurately and set explicit limits.
5. **Integration:** Validate supported current Pi APIs and whether the server's MCP interface is directly consumable or requires an adapter. Do not assume MCP is a Pi extension.
6. **Scope/results:** Constrain workspace/project roots, output cardinality, returned `native` payload size, error handling, cancellation, and startup costs; test against real Go repos.
7. **Maintenance:** Review license, pinning/reproducibility, and whether importing/adapting code is preferable to depending on another runtime/server.

**Keep the separation:** The Go quality server provides *diagnostics*. It does **not** implement the proposed `go_format_write`, `go_mod_tidy`, or `go_dep_add` mutation operations. Those need their own contracts, if prioritized later. Do not turn quality-check requests into automatic fixes or dependency installs.

**Planning disposition:** Put Go diagnostics reuse on the evaluation backlog; do not block JS/TS and Python milestones on it. Record an adopt/adapt/defer decision with evidence after source/API review.

## 7. Tests and evidence required

For every companion tool, plan tests that prove both its intended effects and absence of unintended broader behavior:

- Validate typed inputs and rejection of arbitrary executable/command/argv/script fields.
- Verify explicit path scopes (including `..`, symlink, absolute path, pathspec interpretation, worktrees, and repository/workspace roots where relevant).
- Verify fixed backend/flags, timeouts, output truncation, cancellation where supported, and structured failures.
- Assert exact pre/post filesystem diffs for formatter, lint and dependency mutations, using disposable fixture repos.
- Assert Git branch/index/history/remote effects in local throwaway bare repositories; include push rejection/non-fast-forward and no-force behavior.
- Show `CAPABILITY_GAP` rather than attempted shell fallback for unsupported operations.
- Verify no general executor is model-facing and that loading the core alone does not expose companion tools.
- Verify source examples are copyable, all `docs/stacks/` links resolve, and root README references to docs are absolute GitHub URLs because docs aren't included in the package tarball.
- Run project standard tests/typecheck/Biome checks and integration tests against the supported Pi version.

Performance should be assessed at the full workflow level (inspect -> edit/format/fix -> validate -> inspect diff -> stage/commit/push), not just individual subprocess speed. Treat semantic fidelity and visible gaps as higher priority than speed.

## 8. Requested output from the codebase agent

**Do not begin broad implementation until the implementation plan is reviewed.** First inspect the actual repo and current Pi APIs, then produce:

**A1. Repository inventory:** Which existing code/tools/configuration can be reused, how extensions are registered/selected, packaging boundaries, and any discrepancies with this handoff.

**A2. P0 implementation plan:** File/module organization, proposed typed tool schemas, exact fixed process invocations or libraries, effects and limits, test fixtures, and milestones for shared Git (including push), JS/TS formatting, Python formatting, and copyable check templates.

**A3. P1 plan:** JS/TS and Python scoped lint fixes and dependency changes, with package-manager variant decisions and explicit lifecycle-script/side-effect analysis.

**A4. Go fit report:** Adopt/adapt/defer recommendation for `mcp-server-go-quality`, with API, configuration, installation, source-side-effect and Pi-integration findings. Don't build the Go integration yet unless separately approved.

**A5. Documentation/migration plan:** Turn recipes into linked working examples while preserving accurate implemented-vs-proposed labels and avoiding automatic tool exposure.

**A6. Acceptance matrix:** Per-tool happy-path/failure/scope tests and a full no-shell agent workflow demonstration.

**A7. Open decisions:** Only genuine issues requiring developer choice (for example permitted Git push remote/upstream semantics, package-manager initial coverage, formatter selection). Provide a recommended default for each; don't invent broad new policy machinery.

## 9. Governing boundary

**The model chooses a narrow, permitted operation with bounded typed arguments; trusted code implements it. A missing operation remains `CAPABILITY_GAP`, never a reason to restore Bash or generic execution.**

This handoff captures product direction, not a claim that any proposed companion extension has been implemented or integrated. Current repository content must be verified by the agent before a concrete implementation plan is finalized.

## References

- pi-nobash source: https://github.com/afshinator/pi-nobash
- `docs/stacks/` inventory and invariants supplied in the handoff conversation (2026-10-11).
- Product specification v1.7.3 (2026-10-09), sections 1–7, 9–12.
- Bash substitution assessment v3.2.1 (2026-10-09), sections 3–6 and 9–11.
- Go quality server and README: https://github.com/afshinator/mcp-server-go-quality
