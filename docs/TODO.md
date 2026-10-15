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
- [ ] **Codemode: tool or excluded execution path? (evaluation).** Research
      ["What is Codemode" (Armin Ronacher, 2026-10-06)](https://lucumr.pocoo.org/2026/10/6/codemode/)
      and decide whether pi-nobash should support codemode as a tool/stack. Pi 1.0 exposes
      codemode as LLM-issued JavaScript tool calls composed on the harness side in a
      QuickJS/WASM sandbox (no network, no filesystem, no timers; enabled with
      `defaultTools: ["+codemode"]` or MCP). Today pi-nobash treats codemode only as general
      execution: it is in `KNOWN_GENERAL_EXECUTION_TOOLS` (`src/constants.ts`) and every stack
      guide passes `--exclude-tools bash,powershell,codemode`. Resolve:
  - [ ] accepted: codemode reopens a generic execution route in principle (a script composes tool calls); the open question is how much the harness API narrows it. Determine from the installed Pi runtime and its source/docs — not the article — whether a codemode script sees only the active tools' typed schemas, or a generic escape (arbitrary tool names/argv, `bash`, authoring new tools at runtime)
  - [ ] if the surface is typed, does that typing actually shrink the hallucinated-chaos surface versus raw bash, or is it cosmetic (any active tool callable with model-authored arguments)?
  - [ ] can codemode reach `bash` or any non-frozen program once bash is excluded, or only the tools left active?
  - [ ] if supported, which tools may a codemode script see, and does model-authored codemode count as model-authored argv/config (PD6) or as bounded composition?
  - [ ] verify Pi 1.1.0 codemode semantics and its interaction with `--exclude-tools`/`defaultActive` against the installed runtime, not the article
  - [ ] record an adopt/adapt/defer decision with the smallest complete change, or why codemode stays excluded

## Known debt

- [ ] **Integration suite runs real backends; the Expo branch is expensive (2026-10-14).**
      The companion integration tests run the REAL binary when it is on `PATH` and skip with a
      printed reason otherwise: `npm`, `expo`, `uv`, `ruff`, `eslint`, `biome`. Verify with
      `npm test` (the skip list names the missing binary).
      `tests/integration/companions-deps.test.ts` — `expo_dep_add (REAL expo)` (line 399) —
      bootstraps the SDK into a throwaway project with `npm install expo@<major>`, where the
      major comes from `expo --version`; `expo@latest` was broken on 2026-10-14 (ETARGET
      `@expo/cli@^58.1.9`), so the fixture pins the CLI's major. It runs on every run where
      `expo` is on `PATH`; measured ~331 MB in `node_modules` (~5-26 s here). If CI cost
      matters, gate that branch behind an opt-in env var, mirroring `PI_NOBASH_LIVE_PROVIDER`
      (that provider-credential test is the only permanent skip; the rest are binary-gated).
      Local tooling used to exercise them: `uv` (Homebrew), `uv tool install ruff`,
      `npm install -g eslint expo`.
- [ ] `npm run fallow` reports 32 refactor targets (no correctness defects) — deferred
- [ ] Assessment 411-vs-414 call-count discrepancy is unreconciled (needs the original transcripts)
- [ ] Optional mutations beyond those listed above remain unplanned by design
