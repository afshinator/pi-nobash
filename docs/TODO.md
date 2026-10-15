# TODO

History and scope for pi-nobash. **Checked items keep their date and commit and are never
removed** — that is the history of what was done. The live queue is GitHub Issues
(`gh issue list --state open`), configured by `docs/agents/issue-tracker.md`.

- Product requirements: [product spec v1.7.3](./pi-nobash-product-spec-v1.7.3.md)
- Technical deltas: [amendments](./pi-nobash-technical-spec-amendments.md) (authoritative over the technical spec)
- Design rationale: [design decisions](./design-decisions.md)
- Stack usage: [stack setups](./stacks/README.md)
- Companion planning brief: [stack companions handoff](./pi-nobash-stack-companions-handoff-2026-10-11.md)

## Done

- [x] Product spec v1.7.3, technical spec v2.3, Bash substitution assessment v3.2.1, amendments A1–A9 — 2026-10-09, `cddbfe5`
- [x] Build/test toolchain: `node:test`, `tsc --noEmit`, Biome, Fallow, package scaffolding — 2026-10-09, `53ec1c4`
- [x] Pi extension entrypoint, unconditional Bash blocker, `/nobash-status` — 2026-10-09, `a2db58b`
- [x] `json_query` and streaming `query_jsonl` — 2026-10-09, `a8e055d`
- [x] Read-only `git_status` / `git_diff` / `git_log` / `git_show` — 2026-10-09, `b82bb3b`
- [x] Developer-named `run_validation` with the verified `node_test` adapter — 2026-10-09, `5527658`
- [x] Test suite: unit, I1–I9 integration, coverage manifest, paired performance — 2026-10-09, `196a626`
- [x] Amendment A10 (validation config read once at session start) — 2026-10-09, `f045588`
- [x] Run 2 closed the four open criteria; 91/91 tests; 11/11 DoD — 2026-10-10
- [x] Amendments A11–A14 (promptSnippet, annotations, declared imports, inactive-by-default, metadata) — 2026-10-10, `f0104ab`
- [x] Nits N1–N5 fixed (perf write, live-provider gating, snapshot release, crash-safe cleanup, path cap); 97 tests — 2026-10-10, `03747fb`
- [x] Adoption README and linked guides split (validation, tool reference, design decisions, replacing Bash) — 2026-10-10, `0c5a0f6`
- [x] `docs/stacks/` stack setups (TypeScript incl. Expo, Python, Rust/Go) — 2026-10-12, `96e5af1`
- [x] Removed the superseded `docs/older/` revisions — 2026-10-12, `ab19ece`
- [x] Renamed `docs/ROADMAP.md` to `docs/TODO.md`, ignored every `run-details/` repo-wide, checked in the remaining run configs, and deleted the merged `feat/companions-p0` branch — 2026-10-14, `947417e`

## P0 — stack companions: shared Git and formatters

Planned and specified by
[the companions implementation plan](./plans/pi-nobash-companions-implementation-plan.md)
(`task-plan-4`); see also the
[companions handoff](./pi-nobash-stack-companions-handoff-2026-10-11.md) §3. Each item
below links its plan section; contracts (schemas, fixed argv, `details` shapes, tests)
are frozen there (FD1–FD6).

- [x] Shared Git mutations: `git_create_branch`, `git_add`, `git_commit`, `git_push` —
      explicit-path staging only, non-force push to a configured remote, current branch
      only, no refspec field; `setUpstream` is the single documented boolean
      ([plan A2](./plans/pi-nobash-companions-implementation-plan.md#a2-p0-implementation-plan)) — 2026-10-14, `5e6ea18`
- [x] `js_format_write` (Node/web and Expo; Prettier default, Biome switch via project config per FD5)
      and `py_format_write` (Ruff) — workspace-scoped, fixed argv
      ([plan A2](./plans/pi-nobash-companions-implementation-plan.md#a2-p0-implementation-plan)) — 2026-10-14, `5e6ea18`
- [x] Copyable `.pi/pi-nobash.json` templates (JS/TS npm + pnpm, Expo, Python venv + uv)
      — done by the planning run (`task-plan-4`), 2026-10-11:
      [docs/stacks/examples/](./stacks/examples/ts-node-npm.json) (5 files, Biome-clean)
- [x] Companion layout under `companions/` (shipped reference source, never
      auto-loaded by core; FD2) and the no-companion-on-core-load test
      ([plan FD1/FD2, A6](./plans/pi-nobash-companions-implementation-plan.md#frozen-decisions)) — 2026-10-14, `5e6ea18`

## P1 — stack companions: lint fixes and dependencies

Contracted by
[the companions implementation plan, A3](./plans/pi-nobash-companions-implementation-plan.md#a3-p1-plan--lint-fixes-and-dependency-mutations):
safe-mode lint fixes only (no `--unsafe-fixes`, never via `run_validation`);
`js_dep_*` always `--ignore-scripts`; `expo_dep_add` uses `npx expo install`, never
plain npm; Python deps on uv only; every package name grammar-validated with no
version specifiers or URL/VCS forms; no model-supplied flags anywhere.

- [x] `js_lint_fix` (Biome/ESLint safe fixes), `py_lint_fix` (`ruff check --fix`);
      unsafe modes stay a separate, unconsidered P2 — 2026-10-14, `b583700`
- [x] `js_dep_add`, `js_dep_remove` (npm), `expo_dep_add` (`npx expo install`)
      — 2026-10-14, `2585131`
- [x] `py_dep_add`, `py_dep_remove` (uv only; Poetry/pipenv/pip are `CAPABILITY_GAP`)
      — 2026-10-14, `2585131`

## Live queue (GitHub Issues)

Work is tracked as GitHub issues; `gh issue list --state open` is the queue. The tracker and
triage conventions live in `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.
The nine open items below were migrated from this document on 2026-10-15; each issue keeps its
original context.

- [#1](https://github.com/afshinator/pi-nobash/issues/1) — P2: `fs_copy`, `fs_move` (workspace-scoped)
- [#2](https://github.com/afshinator/pi-nobash/issues/2) — P2: `git_rm_cached` (index-only)
- [#3](https://github.com/afshinator/pi-nobash/issues/3) — P2: `fs_delete`, `rust_clippy_fix` (deferred)
- [#4](https://github.com/afshinator/pi-nobash/issues/4) — Evaluate `mcp-server-go-quality` as a Go diagnostics companion
- [#5](https://github.com/afshinator/pi-nobash/issues/5) — Rust and Go mutation tools
- [#6](https://github.com/afshinator/pi-nobash/issues/6) — Evaluate codemode as a tool or excluded execution path
- [#7](https://github.com/afshinator/pi-nobash/issues/7) — Resolve the 32 fallow refactor targets
- [#8](https://github.com/afshinator/pi-nobash/issues/8) — The integration suite runs real backends; the Expo branch is expensive
- [#9](https://github.com/afshinator/pi-nobash/issues/9) — Reconcile the 411-vs-414 call-count discrepancy

Standing scope note, not a ticket: optional mutations beyond those listed remain unplanned by
design.
