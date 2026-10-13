# Roadmap

The single tracker for pi-nobash. **Checked items keep their date and commit and are never
removed** — that is the history of what was done. Unchecked items are the queue, ordered by
priority. Detail always lives in the linked document, not here.

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

## P0 — stack companions: shared Git and formatters

Planned and specified by
[the companions implementation plan](./plans/pi-nobash-companions-implementation-plan.md)
(`task-plan-4`); see also the
[companions handoff](./pi-nobash-stack-companions-handoff-2026-10-11.md) §3. The items
below are **not implemented** — each links its plan section; contracts (schemas,
fixed argv, `details` shapes, tests) are frozen there (FD1–FD6).

- [ ] Shared Git mutations: `git_create_branch`, `git_add`, `git_commit`, `git_push` —
      explicit-path staging only, non-force push to a configured remote, current branch
      only, no refspec/upstream field in P0
      ([plan A2](./plans/pi-nobash-companions-implementation-plan.md#a2-p0-implementation-plan))
- [ ] `js_format_write` (Node/web and Expo; Prettier default, one-line Biome switch)
      and `py_format_write` (Ruff) — workspace-scoped, fixed argv
      ([plan A2](./plans/pi-nobash-companions-implementation-plan.md#a2-p0-implementation-plan))
- [x] Copyable `.pi/pi-nobash.json` templates (JS/TS npm + pnpm, Expo, Python venv + uv)
      — done by the planning run (`task-plan-4`), 2026-10-11:
      [docs/stacks/examples/](./stacks/examples/ts-node-npm.json) (5 files, Biome-clean)
- [ ] Companion layout under `companions/` (GitHub-only reference source, never
      auto-loaded by core) and the no-companion-on-core-load test
      ([plan FD1/FD2, A6](./plans/pi-nobash-companions-implementation-plan.md#frozen-decisions))

## P1 — stack companions: lint fixes and dependencies

Contracted by
[the companions implementation plan, A3](./plans/pi-nobash-companions-implementation-plan.md#a3-p1-plan--lint-fixes-and-dependency-mutations):
safe-mode lint fixes only (no `--unsafe-fixes`, never via `run_validation`);
`js_dep_*` always `--ignore-scripts`; `expo_dep_add` uses `npx expo install`, never
plain npm; Python deps on uv only; every package name grammar-validated with no
version specifiers or URL/VCS forms; no model-supplied flags anywhere.

- [ ] `js_lint_fix` (Biome/ESLint safe fixes), `py_lint_fix` (`ruff check --fix`);
      unsafe modes stay a separate, unconsidered P2
- [ ] `js_dep_add`, `js_dep_remove` (npm), `expo_dep_add` (`npx expo install`)
- [ ] `py_dep_add`, `py_dep_remove` (uv only; Poetry/pipenv/pip are `CAPABILITY_GAP`)

## P2 — deferred

- [ ] `fs_copy`, `fs_move` (workspace-scoped, on demonstrated need)
- [ ] `git_rm_cached` (index-only)
- [ ] `fs_delete`, `rust_clippy_fix` (deferred; no recursive delete, no implicit unsafe fixer)

## Later / evaluation

- [ ] **Go diagnostics reuse (deferred from task-plan-4).** Decide adopt/adapt/defer for
      [`mcp-server-go-quality`](https://github.com/afshinator/mcp-server-go-quality) as a Go
      diagnostics companion. Deferred because it needs read-only source/network review of an
      external repo; `task-plan-4` records the question, this checklist, and the reason
      instead of an evaluation. Resolve when picked up:
  - [ ] automatic `install_tools` must never be exposed as a read-only check or run silently
  - [ ] its `extra_args` must not become model-supplied argv (review config ownership and session-load behavior)
  - [ ] the model may choose only enumerated diagnostics and bounded scope
  - [ ] verify side effects: caches, tool/binary downloads, network access, project-controlled code
  - [ ] confirm Pi integration (MCP is not a Pi extension; adapter or Pi-native rewrite)
  - [ ] constrain workspace roots, output cardinality, `native` payload size, cancellation
  - [ ] review license, pinning/reproducibility, and adapt-vs-depend
- [ ] Rust and Go mutation tools (`rust_format_write`, `go_format_write`, `go_mod_tidy`, dependency tools)

## Known debt

- [ ] `npm run fallow` reports 32 refactor targets (no correctness defects) — deferred
- [ ] Assessment 411-vs-414 call-count discrepancy is unreconciled (needs the original transcripts)
- [ ] Optional mutations beyond those listed above remain unplanned by design
