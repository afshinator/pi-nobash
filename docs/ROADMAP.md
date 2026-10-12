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

Planned by `task-plan-4`; see the [companions handoff](./pi-nobash-stack-companions-handoff-2026-10-11.md) §3.

- [ ] Shared Git mutations: `git_create_branch`, `git_add`, `git_commit`, `git_push` (non-force, typed remote/branch)
- [ ] `js_format_write` (Node/web and Expo)
- [ ] `py_format_write`
- [ ] Real, copyable `.pi/pi-nobash.json` templates for JS/TS and Python

## P1 — stack companions: lint fixes and dependencies

- [ ] `js_lint_fix`, `py_lint_fix` (safe mode first; unsafe separate)
- [ ] `js_dep_add`, `js_dep_remove`, `expo_dep_add`
- [ ] `py_dep_add`, `py_dep_remove` (one supported workflow first — uv or Poetry, not all)

## P2 — deferred

- [ ] `fs_copy`, `fs_move` (workspace-scoped, on demonstrated need)
- [ ] `git_rm_cached` (index-only)
- [ ] `fs_delete`, `rust_clippy_fix` (deferred; no recursive delete, no implicit unsafe fixer)

## Later / evaluation

- [ ] Go diagnostics reuse: adopt/adapt/defer decision on `mcp-server-go-quality` (evaluation only, no integration yet)
- [ ] Rust and Go mutation tools (`rust_format_write`, `go_format_write`, `go_mod_tidy`, dependency tools)

## Known debt

- [ ] `npm run fallow` reports 32 refactor targets (no correctness defects) — deferred
- [ ] Assessment 411-vs-414 call-count discrepancy is unreconciled (needs the original transcripts)
- [ ] Optional mutations beyond those listed above remain unplanned by design
