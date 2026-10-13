# pi-nobash — Technical Specification Amendments

**Status:** Living amendment record. Update whenever an implementation decision changes.
**Date opened:** 2026-10-09
**Amends:** `pi-nobash-technical-implementation-spec-v2.3.md`
**Authority:** Product Specification v1.7.3 remains authoritative and is not amended here. This document resolves only technical-spec silence, ambiguity, or cases where the pinned Pi 1.1.0 runtime differs from the spec's text. No amendment expands product scope.

## How to use this document

- Every amendment has a stable code `A1..An`. Codes are never reused or renumbered.
- `Disposition` is one of:
  - **CONTRACT** — normative; peers implement it and tests prove it.
  - **TEST-GATED** — behavior must be proven against Pi 1.1.0; the spec text is not a guarantee.
  - **PROCESS** — changes the delivery workflow, not the product surface.
- Amending a spec section means: where the spec and this document disagree, this document wins for the technical implementation. If an amendment would change a product requirement, it is rejected and escalated instead.
- The working checklist and per-item evidence live in `.mypi/task-implement-1/run-details/plan.md`; this document explains the reasoning behind those contracts.

## Reconciliation rules (mandatory for every amendment)

Every amendment, and every implementation slice that follows it, must reconcile with three constraints. A proposed change that fails any of them is rejected rather than recorded.

1. **Project goal.** State which product goal (G1-G7) and acceptance criterion (AC1-AC11) the decision serves, and confirm it adds no model-facing capability that Product Spec v1.7.3 does not already call for. Uncalled-for functionality is a rejection reason, not a nice-to-have.
2. **Ponytail.** State the smallest complete change that works and what was deliberately skipped. No new abstraction, option, dependency, or "for later" structure.
3. **TDD.** State the proving test that fails first (RED) for the new behavior, then passes (GREEN). The spec's I1-I9 checks are test-first and PENDING until executed.

## Reconciliation of recorded amendments

| Code | Serves | Model-facing capability added | Ponytail note | Proving test |
|---|---|---|---|---|
| A1 | DoD test commands; AC6/AC11 | none (dev tooling) | stdlib `node:test`; no framework, no build step | `tests/toolchain.test.ts` |
| A2 | G5, AC1/AC10 | none | follows the host's own rule; avoids a duplicate install | manifest check + I1/I9 |
| A3 | run-config mandate | none (dev tooling) | two scripts, no new config file | command exits 0 |
| A4 | G2/G4/G7, AC6/AC8 | none beyond §11-12 verbs | element shape only; no query language, verb list unchanged | `tests/unit/json/` |
| A5 | G4/G6, AC7/AC9 | none (result envelope) | one channel; no error-class hierarchy | error-code fixtures |
| A6 | G2/G4, AC6 | none (read-only Git only) | fixed fields; no flag/revspec passthrough | `tests/unit/git/` |
| A7 | G2/G4/G6, AC6/AC7/AC9 | none; narrows the surface | one verified adapter; reject-by-default | `tests/unit/validation/` |
| A8 | G1/G5, AC2/AC3/AC10 | none | no guessed API frozen; the test decides | I2/I3/I7/I8 |
| A9 | AC6/AC9, reviewer mandate | none (process) | one plan.md; no second spec file | reviewer checks plan.md contracts |
| A10 | G1/G4, AC7 | none; narrows the surface | delete the per-cwd lazy map; one read, one immutable value | post-activation rewrite + foreign-cwd tests |
| A11 | G2/G4, AC6/AC7 | none; discovery and metadata only | one-line snippets and hints; declare an already-imported host package | snippet, annotation, and import-declaration tests |
| A12 | G1/G3, AC2/AC4 | none; withholds capability until selected | no config; rely on Pi native selection | all seven tools assert `defaultActive: false` |
| A13 | G5, AC10 | none | omit importable-entry fields a consumer never uses | package.json manifest check |
| A14 | G5 | none | keep the committed, tested path | integration tests load the extension |

No amendment adds a model-facing capability beyond Product Spec v1.7.3. A future amendment that would is rejected here and escalated to a product decision instead.

## Amendment index

| Code | Subject | Amends | Disposition |
|---|---|---|---|
| A1 | Build/test tooling and module conventions | §5 layout, §5.1, §20 | CONTRACT |
| A2 | Host-package dependency layout | §5.1 | CONTRACT |
| A3 | Quality-tool scripts (Biome, Fallow) | §20, §22 | CONTRACT |
| A4 | JSON/JSONL operator element shapes | §11.3, §11.6, §11.8, §12.3 | CONTRACT |
| A5 | Result/error envelope and return channel | §9.3, §9.4, §16 | CONTRACT |
| A6 | Git tool output schemas and revision rule | §13.2–§13.5 | CONTRACT |
| A7 | Validation runner adapter registry | §8.2, §14.4, §14.5 | CONTRACT |
| A8 | Pi API disposition | §3.6, §3.9, §17, §24 | TEST-GATED |
| A9 | Pre-dispatch contract freeze | §22 delivery sequence | PROCESS |
| A10 | Validation config load semantics (activation-time read) | §8.1, §8.2, §14 | CONTRACT |
| A11 | Tool-registration completeness (promptSnippet, hints, declared imports) | §3.6, §9.2 | CONTRACT |
| A12 | Inactive-by-default packaged tools | §3.3, §6.1, §7.2 | CONTRACT |
| A13 | Package metadata: no main/exports/license/repository | §5.1 | CONTRACT |
| A14 | Entry path stays ./extensions/pi-nobash.ts | §5 | CONTRACT |

---

## A1 — Build/test tooling and module conventions (CONTRACT)

**Amends:** §5 (package layout), §5.1 (`package.json`), §20 (tests).

**Decision.** The package has no build step. Tests run on Node's built-in `node:test`; typechecking runs `tsc --noEmit`; relative imports use explicit `.ts` specifiers; `tsconfig.json` sets `module`/`moduleResolution: "NodeNext"`, `noEmit`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `isolatedModules`, `strict`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

**Why.** Pi's own documentation states that it loads TypeScript extensions through `jiti` and that "local TypeScript extensions do not need a separate compilation step," so a build step would test a different artifact than the one Pi loads. Node 24 runs `.ts` directly (type stripping) and `node --test` discovers `*.test.ts`; this was verified in this environment (`node --test` built and ran a `.ts` test importing `typebox` and a relative `.ts` module). Using the platform runner avoids adding a test framework to a package whose runtime loader is already jiti. `erasableSyntaxOnly` converts Node's strip-only runtime limitation (`enum`/`namespace` are rejected) into a compile-time error, so that class of failure can never appear only during tests.

**Alternatives rejected.** Vitest/jest: extra dependency for no capability this package needs, and a second TypeScript execution path alongside jiti. A `tsc` build to `dist/`: produces a different artifact than Pi executes and adds a stale-build failure mode. `--experimental-transform-types`: a second, divergent TS implementation; only justified if a slice genuinely needs non-erasable syntax.

**Verification.** `npm run typecheck && npm test` pass; `tests/toolchain.test.ts` proves `.ts` execution, bare `typebox` resolution, and `.ts` specifiers.

---

## A2 — Host-package dependency layout (CONTRACT)

**Amends:** §5.1, which pins `peerDependencies` to `@earendil-works/pi-coding-agent: 1.1.0` and `typebox: 1.3.27`.

**Decision.** Host-provided packages are declared as `peerDependencies` with the `"*"` range. Exact versions are pinned only in `devDependencies` (`@earendil-works/pi-coding-agent@1.1.0`, `typebox@1.3.27`).

**Why.** Pi's `docs/packages.md` requires host-provided packages (`pi-coding-agent`, `typebox`, etc.) to be declared with a `"*"` range and not bundled; a physical copy can bypass Pi's extension module mapping and create duplicate registries and classes, and Pi emits a warning when it detects this manifest shape. The spec's exact pins contradict the runtime's documented contract, and §25 already classifies bundling host packages as nonconforming. Exact pins in `devDependencies` preserve the 1.1.0/1.3.27 test target without shipping a duplicate.

**Alternatives rejected.** Keeping the spec's exact `peerDependencies` pins: would trip Pi's duplicate-host-package warning and force an exact-version resolution on consumers. Odd majors in `peerDependencies` ranges: unnecessary strictness for a pinned-target package.

---

## A3 — Quality-tool scripts (CONTRACT)

**Amends:** §20/§22 (test tooling), and the orchestration requirement to run Fallow and Biome.

**Decision.** `package.json` exposes `lint: "biome check ."` and `fallow: "fallow health"`, with `@biomejs/biome@2.5.15` and `fallow@3.33.0` in `devDependencies`.

**Development-only guarantee.** Biome and Fallow are development tools for building pi-nobash; they are not capabilities, dependencies, or shipped files of the pi-nobash package. This is enforced three ways: (1) they appear only in `devDependencies`, never in `dependencies`, `peerDependencies`, or the `pi` manifest; (2) Pi's own installer omits dev dependencies when installing a package (`--omit=dev --legacy-peer-deps` for npm, `--omit=dev --omit=peer` for bun, `--prod` for pnpm; verified in `dist/core/package-manager.js`); (3) `package.json` sets a `files` allowlist of `src`, `extensions`, `assets`, `companions`, `README.md` (companions ship as reference source but are never auto-loaded), so an npm tarball contains no dev tooling, no `tests/`, no `docs/`, and no `.mypi/` run state. Verified with `npm pack --dry-run`: before the allowlist the tarball shipped all specs and the run state; after it, only `README.md` and `package.json` (plus `extensions/`/`src/` once they exist).

**Why.** The run configuration mandates Fallow and Biome checks, but the technical spec never defines a runner or script. Naming them keeps the commands reproducible from a clean clone. `biome check .` (not an explicit `extensions src tests` list) is used because Biome errors on directories that do not exist yet, which would make the baseline red before any source exists; `.` respects Biome's default ignores.

**Alternatives rejected.** Listing source directories explicitly: fails until every directory exists. Relying on globally installed binaries only: not reproducible across machines.

**Note.** Biome's default formatter indents with tabs; the repository adopts that, matching Pi's own example files. Formatting was applied via `biome check --write`.

---

## A4 — JSON/JSONL operator element shapes (CONTRACT)

**Amends:** §11.3, §11.6, §11.8, §12.3, which name `Predicate`, `Selection`, `Aggregate`, and `OrderBy` but never define their object shape.

**Decision.** Concrete element types (`JsonPath` from §11.4):

```ts
type PredicateOp = "eq"|"ne"|"lt"|"lte"|"gt"|"gte"|"exists"|"is_null"|"in"|"contains_string";
type Predicate = { path: JsonPath; op: PredicateOp; value?: JsonValue };
type Selection = { as: string; path: JsonPath };
type Aggregate = { as: string; fn: "count"|"sum"|"min"|"max"|"avg"; path?: JsonPath };
type OrderBy = { field: string; direction: "asc"|"desc" };
```

`as` names are unique across `select` + `aggregate`; `orderBy.field` names a scalar projected alias (raw-path ordering is not allowed); `path` is omitted only for `count`; `groupBy` is `Selection[]` and requires aliases on aggregates.

**Why.** The spec is explicit that a typed operator set replaces arbitrary code, but gives two independent tools (and two peers) no shared element definition, so their fixtures could disagree on the same input. Defining the shape is mechanical and removes that drift. Constraining `orderBy` to projected aliases follows §11.8 ("ordering is permitted only on projected scalar fields") and avoids a second, implicit path language. Keeping the verb list identical to §11.5 prevents the operator set from growing into the query language the spec forbids.

**Alternatives rejected.** A string-based path/query mini-language (rejected by §11.4, which chose typed segments). Ordering on raw paths (contradicts §11.8 and adds untyped comparison semantics). More aggregate verbs (unjustified; the assessment marks the operator set provisional pending an audit that was never run, so additions should be deliberate, not speculative).

---

## A5 — Result/error envelope and return channel (CONTRACT)

**Amends:** §9.3, §9.4, §16, which list error codes but never say how a tool returns them.

**Decision.** Every tool returns `AgentToolResult`. Expected errors return `isError: true` with `content[0].text = "<CODE>: <message>"` and `details = { code, capability?, message }`. Only `INTERNAL_ERROR` is thrown. `structuredContent` is set whenever `outputSchema` is declared; truncation sets `truncated: true` and appends a notice to the model-facing text.

**Why.** The installed `@earendil-works/pi-agent-core` 1.1.0 defines `AgentToolResult` with `content`, required `details`, optional `structuredContent`, and optional `isError`, and its own contract comment says "throw on failure, or return a result with `isError: true`; do not only describe the failure in `content`." Without a single chosen channel, `CAPABILITY_GAP` behavior (AC9) is untestable and two tools can encode errors differently. Using `isError` also keeps `details`/`structuredContent` available to callers, which a thrown error loses. The `"<CODE>: "` text prefix makes the required visible failure machine-checkable. Note the runtime distinction: `structuredContent` is programmatic and is not sent to the model, so the model-facing summary must live in `content`.

**Alternatives rejected.** Throwing every error: loses structured details and makes AC9 depend on error-string matching only. Encoding the code only in `content` text: not machine-readable. Using `structuredContent` as the model-facing error: the runtime does not send it to the model.

---

## A6 — Git tool output schemas and revision rule (CONTRACT)

**Amends:** §13.2–§13.5, which give precise inputs but only "normalized branch/head state and file status entries" as output, and require revision validation without a rule.

**Decision.** Fixed `details` shapes:

- `git_status`: `{ branch: string|null; head: string|null; detached: boolean; entries: Array<{ path: string; originalPath?: string; index: string; worktree: string }> }`
- `git_diff`: `{ mode: "working"|"staged"|"commit"; revision?: string; paths: string[]; contextLines: number; filesChanged: number; truncated: boolean; diff: string }`
- `git_log`: `{ entries: Array<{ hash: string; shortHash: string; author: string; authorEmail: string; timestamp: string; subject: string }>; truncated: boolean }`
- `git_show`: `{ revision: string; hash: string; author: string; timestamp: string; subject: string; body: string; diff: string; truncated: boolean }`

Revision strings are rejected unless they pass a conservative charset/shape check and then resolve via `git rev-parse --verify --quiet <rev>^{commit}`; revisions and paths are never placed after `--`, and model paths whose final segment starts with `-` are rejected.

**Why.** The capability fixtures in §20.4 assert "correct normalized repository state," which is not checkable without field names. More importantly, the revision string is the one Git input the model controls that reaches argv, so the validation rule is a boundary control, not cosmetics: a loose rule lets option-like or revision-range tokens through and violates §25's prohibition on flag/path passthrough. Requiring `rev-parse --verify` confirms the token is a real commit before any operation runs.

**Alternatives rejected.** Returning raw `git status --porcelain` text: pushes parsing into the model and is not a normalized schema. Allowing arbitrary revspecs (`A..B`, `@{...}`): broadens the surface beyond single-revision inspection. Relying on `--` for paths: Git's path/revision separation is ambiguous enough that rejecting option-like inputs outright is safer.

---

## A7 — Validation runner adapter registry (CONTRACT)

**Amends:** §8.2 and §14.4/§14.5, which describe `argumentMode: "runner_verified_file_selector"` as a "declarative marker" and say to reject unverified targets, without defining the adapter or which runners exist.

**Decision.** Configuration names an explicit `runner` adapter. The adapter is `(check, targets: string[]) => string[]`, returning the exact argv suffix appended to `check.program` + `check.args`, and lives in a trusted registry. A single adapter, `node_test` (suffix `["--", ...targets]`), is verified; every other runner must use `targets.mode: "none"` until a test records its verified syntax. Unknown runner or targets without an adapter are rejected before process start.

**Why.** This is the seam where a no-execution product can accidentally reintroduce general execution: the adapter is what turns a model-chosen target into argv. Leaving it undefined lets one peer append raw target strings (a §25 violation) while another implements nothing (a fixture failure). Naming `runner` instead of the spec's `argumentMode` marker makes the choice explicit and testable. Restricting to verified adapters enforces §14.5 rule 10 ("if the runner-specific adapter has not been verified ... reject") mechanically rather than by convention. `node --test -- <file>` selection was verified in this environment; `--` is used so an option-like target cannot be read as a flag.

**Alternatives rejected.** A generic "append targets" behavior: exactly the passthrough the product forbids. Supporting several runners up front: each needs its own verified syntax and test; adding them without that evidence is the unverified-target case the spec says to reject.

---

## A8 — Pi API disposition (TEST-GATED)

**Amends:** §3.6, §3.9, §17, §24 — clarifying that APIs the spec asserts are governed by runtime tests, not by the text.

**Decision.** `pi.registerCommand(name, { description, handler })`, `pi.registerTool({ ..., exposure: "direct", defaultActive: false })`, and `pi.on("tool_call", ...)` returning `{ block: true, reason }` are treated as TEST-GATED and confirmed by I2/I3/I7/I8. Extension-tool coexistence and per-session SDK selection are confirmed by I4/I5/I6. A runtime result that contradicts the text amends this record; the text never overrides a failing test.

**Why.** §24 already labels these PENDING-TEST, while §6 and §17 present them as settled (`registerStatusCommand` is pseudocode). Writing a guessed API into a normative contract would make the spec assert something no test has proven and would risk a reviewer approving an impossible claim, which the run configuration explicitly forbids ("do not fabricate"). The three APIs above were located in the installed 1.1.0 type declarations and example extensions, so they are likely correct, but "present in the pinned source" is source evidence, not runtime evidence.

**Alternatives rejected.** Freezing them as CONTRACT because the source shows them: collapses the spec's own SRC/PENDING-TEST distinction. Leaving them unspecified: removes the boundary the tests must cover.

---

## A9 — Pre-dispatch contract freeze (PROCESS)

**Amends:** §22 delivery sequence by adding a required gate before Phase 1 dispatch.

**Decision.** The supervisor derives its own list of under-specified decisions from the three source documents and freezes each as an explicit contract in `plan.md` with a name, definition, owner, proving test, and disposition (CONTRACT / TEST-GATED / FREE CHOICE) before dispatching any implementation work order. Unverified Pi APIs are frozen only as TEST-GATED. An area whose shared contract is not frozen is not dispatched.

**Why.** The technical spec pins *what* and the Pi interface but leaves internal design open, and the orchestration prompt never asked for a gap analysis, so a supervisor would otherwise discover under-specification mid-flight, after peers had already chosen incompatible interfaces. Contract A4/A5/A6/A7 above are exactly the items that needed this gate. The gate also gives the reviewer a written target to check, satisfying the mandate to independently verify decisions rather than trust peer reports.

**Alternatives rejected.** Appending a gap list to the technical spec: names the gaps without defining the contracts, and risks asserting unverified APIs as requirements. Adding a second specification file: duplicates the spec's authority and creates a versioning problem. If a checklist item cannot be frozen (missing input, unavailable tool), it is recorded BLOCKED, not passed.

---

## A10 — Validation config load semantics (CONTRACT)

**Amends:** §8.1, §8.2, §14. Resolves the F9 composition route found in run 1 (`task-implement-1`).

**Decision.** `.pi/pi-nobash.json` is read **exactly once per Pi session, at session start** (Pi's `session_start` hook, which carries `ctx.cwd` and fires before any model turn; the extension factory itself receives no cwd, so registration time cannot bind the session directory), and never re-read; the loaded check set is immutable for that session. The snapshot is keyed by session id because one loaded extension can serve several sessions (`DefaultResourceLoader` reuses the factory across sessions); the registration-time `process.cwd()` snapshot is retained only as a fallback for direct, non-session callers. A `run_validation` call whose `ctx.cwd` differs from the session's bound cwd is rejected with `INVALID_ARGUMENT` ("no validation config loaded for this workspace") rather than lazily loading that directory's config. A developer who edits the file starts a new session or reloads extensions. `loadValidationConfig` may still load on demand for direct, non-tool callers.

**Why.** Run 1's reviewer identified a genuine composition route: lazy per-cwd reads let a session holding Pi `write`/`edit` change `program`/`args` in a not-yet-loaded config before its first `run_validation` call, then trigger execution — banned by product spec §4.3. Disler's Level 5 sidesteps this structurally: `run_tests` hardcodes `uv run pytest -q` in the extension source and takes `Type.Object({})` (zero parameters), so there is no writable command surface at all. This amendment reproduces that strength inside the spec's mandated `.pi/pi-nobash.json` path. Session start runs before any model turn, so a single read closes the window; rejecting foreign cwds and keying by session id keep it closed. No capability or config mechanism is added.

**Alternatives rejected.** A config fingerprint/hash: a new capability the product does not call for, and it still races a write before the first read. Moving config out of the workspace: diverges from §8.1's documented path. Lazy per-cwd caching: the exact window run 1 flagged. mtime-based re-reading: still composition.

**Proof.** After session start, overwrite `.pi/pi-nobash.json` and assert `run_validation` still runs the session-start check; a call with a different `ctx.cwd` returns `INVALID_ARGUMENT`; two sessions from one loaded extension each run their own cwd's check (verified A→B→A).

---

## A11 — Tool-registration completeness (CONTRACT)

**Amends:** §3.6 (`ToolDefinition` fields), §9.2 (inputs). Derived from an ecosystem-alignment review of Pi 1.1.0's built-ins and published `pi-package`s.

**Decision.** Every packaged model-facing tool MUST:
1. set a one-line `promptSnippet`, so it appears in the default system prompt's "Available tools" section;
2. set accurate `annotations`: `readOnlyHint: true` on `json_query`, `query_jsonl`, `git_status`, `git_diff`, `git_log`, and `git_show`; no read-only hint on `run_validation`, which spawns a process;
3. import only host packages declared in `peerDependencies` (shipped code) or `devDependencies` (tests) — never rely on transitive hoisting.

**Why.** Pi's own tools (`bash`, `read`, `grep`, `find`, `ls`, `edit`, `write`) all set `promptSnippet`, the `ToolDefinition` documentation states that custom tools are omitted from the "Available tools" section when it is absent, and `dist/core/agent-session.js` collects snippets into the prompt; the closest published analogue, `@aslamplr/pi-safe-shell`, sets it on every tool. Missing annotations default to *not read-only, may be destructive, open world*, which misleads permission-style extensions that read hints. Test code importing an undeclared host package resolves only through npm hoisting and breaks under strict or pnpm installs.

**Alternatives rejected.** Relying on tool descriptions alone: their schema is sent, but the model loses the prose discovery cue every built-in and the closest analogue provide. Setting `readOnlyHint` on `run_validation`: false, since it executes a configured program.

**Proof.** Unit tests asserting: every packaged tool has a non-empty `promptSnippet`; the six read-only tools declare `readOnlyHint` and `run_validation` does not; every bare import in `src/`, `extensions/`, and `tests/` is declared in the package manifest.

---

## A12 — Inactive-by-default packaged tools (CONTRACT)

**Amends:** §3.3 (registration and `defaultActive`), §6.1 (native selection), §7.2 (activation).

**Decision.** Every packaged model-facing tool is registered with `defaultActive: false`. Loading pi-nobash therefore exposes no new tool to any agent until the developer names it in `defaultTools`, `--tools`, or the SDK `tools` array.

**Why.** Product goal G3 requires per-agent choice, and a package that activates tools on install would silently change every agent that loads it, including agents that never opted into those capabilities. This deliberately diverges from Pi's own default for `direct` tools (`defaultActive: true`) and from several ecosystem packages (e.g. `@aslamplr/pi-safe-shell` activates its tools at registration); it is recorded here so the divergence is not mistaken for an oversight. The cost is that installing the package changes nothing for a model on its own; the benefit is that no agent gains a capability it was not configured for.

**Alternatives rejected.** Activating on install with an opt-out: makes the package's presence alone a capability change and violates G3. A package-level profile or enablement list: product spec §6.1 forbids a parallel profile system; Pi's native selection is the mechanism.

**Proof.** All seven tools register `defaultActive: false` and `exposure: "direct"`, asserted for the full set in `tests/integration/phase1.test.ts`; `tests/unit/validation/tool.test.ts` covers `run_validation` directly.

---

## A13 — Package metadata: no main/exports/license/repository (CONTRACT)

**Amends:** §5.1 (package.json shape).

**Decision.** `package.json` declares no `main`, `exports`, `license`, or `repository` field. The extension is reached only through the `pi.extensions` manifest.

**Why.** Pi loads the TypeScript extension through `jiti` from the `pi` manifest; a `main`/`exports` entry would point at a file no consumer imports as a library. No `LICENSE` file exists in the repository, so a `license` identifier would be a claim without a file behind it. A `repository` URL adds nothing to Pi's resolution or npm install. Ecosystem packages vary here (`@arhen/pi-core-subagent` sets `main: "./src/index.ts"`, `pi-safe-shell` sets `main: "index.ts"`), so this is a deliberate minimal choice, not an omission.

**Alternatives rejected.** Adding `main` pointing at the extension: misleading, because the file is not an importable API entrypoint. Adding a license identifier with no LICENSE file: an unverifiable claim.

**Proof.** `package.json` contains none of those fields, and the manifest declares `pi.extensions: ["./extensions/pi-nobash.ts"]`, exercised by the integration tests.

---

## A14 — Extension entry path stays ./extensions/pi-nobash.ts (CONTRACT)

**Amends:** §5 (package layout).

**Decision.** The package keeps `pi.extensions: ["./extensions/pi-nobash.ts"]` rather than the ecosystem-common `./index.ts` or `./src/index.ts`.

**Why.** The path is explicit in the manifest and already exercised by the integration tests; renaming is cosmetic churn with no functional gain. Ecosystem packages use a range of entry paths (`./index.ts`, `./src/index.ts`, `./extensions/workflow.ts`), so no single convention is violated.

**Alternatives rejected.** Renaming for convention parity alone: churn in a committed, tested tree for style only.

**Proof.** The `pi` manifest path resolves and the extension loads in `tests/integration/pi-runtime.test.ts`.

---

## Explicitly not amended

- Product scope, goals G1–G7, acceptance criteria AC1–AC11, and non-goals (Product Spec v1.7.3).
- Hard exclusions: no codemode, interpreters, generic runners, `restricted_exec`, sandbox, or permission framework.
- Deferrals: Git mutations, file-lifecycle operations, linter auto-fixes, and other optional mutations remain out of the v2.3 baseline (spec §15, Phase 5).
- The historical 411-vs-414 call-count discrepancy remains explicitly unreconciled (spec §8, assessment §2.2).

## Open items (not yet decisions)

- Which additional runner adapters, if any, get verified support. Default until then: `targets.mode: "none"`.
- Whether `json_query` needs `orderBy` on unprojected paths for top-N over a root array; currently not allowed (A4).
- Whether the coverage manifest needs fields beyond those named in spec §22 Phase 6.

## Change log

- 2026-10-09 — opened; A1-A9 recorded. A1-A7 CONTRACT, A8 TEST-GATED, A9 PROCESS. Verified against installed Pi 1.1.0 types and this environment's Node 24.19.0.
- 2026-10-09 — added mandatory goal/Ponytail/TDD reconciliation rules and audited A1-A9 against them; no amendment adds uncalled-for model-facing capability.
- 2026-10-09 — A3 clarified: Biome and Fallow are development-only; added a `files` allowlist so the npm tarball cannot ship dev tooling, specs, tests, or `.mypi/` run state. Evidence: Pi `package-manager.js` installs with `--omit=dev`/`--prod`; `npm pack --dry-run` confirmed.
- 2026-10-12 — A3 allowlist updated to the current contents (`src`, `extensions`, `assets`, `companions`, `README.md`): companions ship as reference source and are never auto-loaded (FD2 in the companions implementation plan).
- 2026-10-09 — added A10 (validation config read once at activation, foreign cwd rejected) after run 1's reviewer flagged the F9 composition route; Disler's Level 5 has no writable config surface, which informed the shape of the fix.
- 2026-10-09 — added A11 (tool-registration completeness) from an ecosystem-alignment review of Pi 1.1.0 built-ins and published `pi-package`s: `promptSnippet` on every tool, accurate `readOnlyHint` hints, and no reliance on hoisted host imports.
- 2026-10-09 — added A12 (inactive-by-default packaged tools) to record the deliberate divergence from packages that activate tools on install; implemented since run 1 and asserted by the phase-1 registration test.
- 2026-10-09 — added A13 and A14 recording the run-3 package-metadata and entry-path decisions (no `main`/`exports`/`license`/`repository`; keep `./extensions/pi-nobash.ts`).
