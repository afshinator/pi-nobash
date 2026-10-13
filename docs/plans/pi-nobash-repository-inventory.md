# A1 — Repository inventory (companions planning)

**Date:** 2026-10-11
**Scope:** Facts verified against the repository on disk and the installed
`@earendil-works/pi-coding-agent` 1.1.0 package under `node_modules/`.
**Companion document:** `docs/pi-nobash-stack-companions-handoff-2026-10-11.md`.

---

## 1. Reusable existing code, tools, and configuration

### 1.1 Packaged tools (do not duplicate)

Seven model-facing tools are registered by `extensions/pi-nobash.ts`; names and
bounds live in `src/constants.ts` (`JSON_TOOL_NAME`, `JSONL_TOOL_NAME`,
`GIT_STATUS_TOOL_NAME`, `GIT_DIFF_TOOL_NAME`, `GIT_LOG_TOOL_NAME`,
`GIT_SHOW_TOOL_NAME`, `VALIDATION_TOOL_NAME`; `REPLACEMENT_TOOL_NAMES` array
lines 24–32). All are read-only.

### 1.2 Shared primitives a companion extension should reuse, not re-implement

| Primitive | Location | Contract |
|---|---|---|
| **Bounded git exec runner** | `src/git/exec.ts` — `execGit(args, cwd, signal?)` | `spawn("git", args, { shell: false })`, fixed argv, no model flags; per-stream 100 KB accumulation cap (`MAX_GIT_STREAM_BYTES`), `truncated` flag, AbortSignal support. The direct reuse path for `git_create_branch`/`git_add`/`git_commit`/`git_push`. |
| **Revision validation** | `src/git/rev.ts` — `validateCommitRevision(revision, cwd)` | Charset/shape regex + `git rev-parse --verify --quiet <rev>^{commit}`; rejects whitespace, leading `-`, `..`, `@{`, >255 chars; never placed after `--`. |
| **Model path validation** | `src/git/rev.ts` — `validateModelPaths`; `src/path-policy.ts` — `validateGitPaths`, `assertSafeRelativeGitPath` | Bounded path lists (`MAX_GIT_PATHS = 100`), rejects absolute paths, `..` traversal, NUL, option-like final segments. |
| **Workspace path policy** | `src/path-policy.ts` — `validateWorkspacePath`, `validateWorkspaceFile` | Resolves against cwd, realpath-based symlink-escape rejection (`PATH_OUT_OF_SCOPE`), NUL rejection. Direct reuse for any workspace-scoped companion tool (`js_format_write`, `py_format_write`, `fs_*`). |
| **Error envelope (C3)** | `src/errors.ts` — `ToolError` (codes: `INVALID_ARGUMENT`, `PATH_OUT_OF_SCOPE`, `NOT_FOUND`, `PARSE_ERROR`, `LIMIT_EXCEEDED`, `TIMEOUT`, `VALIDATION_FAILED`, `GIT_FAILED`, `CAPABILITY_GAP`, `INTERNAL_ERROR`), `errorResult`, `successResult`, `toToolErrorResult`, `truncateUtf8` | Expected failures become `isError` results with `<CODE>: <message>` text and `details.code`; never thrown to the model. `CAPABILITY_GAP` is already an error code — companions report gaps through it. |
| **TypeBox schema conventions** | `src/git/index.ts`, `src/json/index.ts`, `src/json/schemas.ts` | `Type.Object` parameter schemas with `maxItems`/`minimum`/`maximum` bounds sourced from `src/constants.ts`; `ToolDefinition<Params, Details>` typing; `promptSnippet` (one line), `annotations: { readOnlyHint: true }`, `exposure: "direct"`, `defaultActive: false`. |
| **Validation config loader** | `src/config.ts` | Parses developer-owned `.pi/pi-nobash.json` (`ValidationCheck`: `program`, `args`, `cwd`, `timeoutMs`, `targets`); model can never author these values. |
| **Validation runner stack** | `src/validation/target.ts` (target resolution), `src/validation/adapter.ts` (`resolveAdapter`, registry with the single verified `node_test` adapter → `["--", ...targets]`), `src/validation/runner.ts` (`runCheck`: spawn, 100 KB per-stream bound, timeout, `truncated`) | Reuse for any companion that needs to run a developer-named check; unknown runner adapters are rejected with `INVALID_ARGUMENT` before process start. |
| **Bash backstop** | `src/pi-guard.ts` — `registerBashBlocker` | `pi.on("tool_call")` blocking `bash` unconditionally; unconditional, never inspects command text. |
| **Status command** | `src/status.ts` — `registerStatusCommand` (`/nobash-status`), pure `buildStatusReport` | Reports active vs registered tools and conformance; `KNOWN_GENERAL_EXECUTION_TOOLS = ["bash","powershell","codemode"]`. |
| **Constants** | `src/constants.ts` | All bounds (`MAX_RESULT_TEXT_BYTES` 64 KB, `MAX_STRUCTURED_ROWS` 500, timeouts, git limits) and `PACKAGE_VERSION`/`TARGET_PI` (2.3.0 / Pi 1.1.0). |

### 1.3 Extension entrypoint pattern

`extensions/pi-nobash.ts` is the single entry: a default-exported factory
`(pi: ExtensionAPI) => void` that only calls `register*` functions
(`registerBashBlocker`, `registerStatusCommand`, `registerJsonTools`,
`registerGitTools`, `registerValidationTools`). Each module owns one
`registerX(pi)` exported from an `index.ts` (`src/git/index.ts`,
`src/json/index.ts`, `src/validation/index.ts`). Companions should follow the
same shape: one factory file, one register function per module, no side effects
at import time.

### 1.4 Test harness

- Runner: `node --test` (`package.json` `scripts.test`), no build step; TS loaded
  natively / via jiti at runtime. TypeScript 5.9.3, `tsc --noEmit` typecheck.
- Unit tests: `tests/unit/{config,git,json,validation}` plus
  `tests/unit/registration.test.ts` (fake `pi` object collecting `registerTool`
  calls; asserts `readOnlyHint`/`promptSnippet` conventions) and
  `tests/unit/readme-links.test.ts` (asserts README doc links resolve — guards
  the absolute-URL rule).
- Integration tests: `tests/integration/` (`phase1.test.ts` asserts all seven
  tools register `defaultActive: false` + `exposure: "direct"`;
  `pi-runtime.test.ts`, `cli-process.test.ts`, `multi-session.test.ts`,
  `helpers.ts`). Companion tools should reuse this fake-`pi` registration-test
  pattern and the integration harness.
- Lint: Biome 2.5.15 (`biome.json`: excludes `.mypi/`, `assets/`, `*.svg`).
- `tsconfig.json`: `strict`, `NodeNext`, `allowImportingTsExtensions`,
  `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`; includes `extensions`, `src`, `tests`,
  `scripts`.
- Tooling: npm (package-lock.json present), Node `>=22.19.0`
  (`package.json` `engines`). Scripts: `test`, `typecheck`, `lint`, `fallow`.

### 1.5 Tool selection (developer levers)

- Pi native: `.pi/settings.json` `defaultTools` and the `--tools` flag. Plain
  names replace the whole selection; `+name`/`-name` add/remove;
  `--no-tools`/`--no-builtin-tools` override (`node_modules/@earendil-works/pi-coding-agent/docs/settings.md` line 40, `docs/cli.md` lines 119–135).
- Default Pi tools are `read`, `bash`, `edit`, `write` — hence the
  `pi-nobash` guidance to run `pi --tools read,grep,find,ls,edit,write,...`
  (with `-bash`) and the unconditional `tool_call` block as backstop.
- SDK/session selection also exists (per Pi docs/settings); the repo documents
  the three levers in `README.md` and `docs/design-decisions.md`.

---

## 2. How Pi registers and selects extensions and packages (verified against Pi 1.1.0)

### 2.1 `pi` manifest

- `node_modules/@earendil-works/pi-coding-agent/dist/core/pi-manifest.js` —
  `readPiManifest()` reads `package.json`, requires an object `pkg.pi`, and
  accepts only `extensions`, `skills`, `prompts`, `themes` as string arrays.
- This repo's manifest: `package.json` → `"pi": { "extensions":
  ["./extensions/pi-nobash.ts"] }`.

### 2.2 Package loading

- `dist/core/package-manager.js` `collectPackageResources()` (~line 1860): for
  an installed package root, Pi first reads the **root** `package.json` `pi`
  manifest. If absent, it falls back to conventional directories
  (`<root>/extensions/`, `<root>/skills/`, ...). It never recurses into nested
  `package.json` files.
- Install sources (`docs/packages.md` lines 9–24): `pi install npm:…`,
  `git:…`, or a local path `./dir` (loaded in place, not copied); `pi -e …`
  tries a package for one invocation. Declarations go to
  `~/.pi/agent/settings.json` or, with `--local`, `.pi/settings.json`
  (project packages load only after project trust).
- Host-provided packages supplied to extensions:
  `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`,
  `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`.
  These belong in `peerDependencies` with `"*"` and must not be in
  `dependencies`. This repo complies: `package.json` declares
  `"peerDependencies": { "@earendil-works/pi-coding-agent": "*", "typebox":
  "*" }` and zero runtime dependencies.
- Settings object form can filter per-resource: `"extensions":
  ["extensions/*.ts", "!extensions/legacy.ts"]`, `[]` disables, `autoload:
  false` makes the project entry a delta over the personal one
  (`docs/packages.md` lines ~87–110).

### 2.3 File-extension auto-discovery (project/user scope)

`dist/core/package-manager.js` `collectAutoExtensionEntries()` /
`resolveExtensionEntries()` (~lines 378–431), invoked at ~lines 2037/2055:

- Scanned directories are exactly `<project>/.pi/extensions/` (only when the
  project is trusted) and `~/.pi/agent/extensions/`. Nothing else is scanned.
- Within a scanned directory: a `package.json` with a `pi.extensions` manifest
  wins; otherwise `index.ts`/`index.js` wins; otherwise every top-level
  `.ts`/`.js` file is collected (dotfiles and `node_modules` skipped, `.gitignore`
  honored).
- **Consequence:** `resolveExtensionEntries()` does honor a nested
  `package.json` `pi` manifest and `index.ts` for **subdirectories of a scanned
  extensions directory**. So a `companions/git/package.json` with a `pi`
  manifest *would* be respected **if** that directory (or its parent) were
  copied/symlinked into `.pi/extensions/` or `~/.pi/agent/extensions/`, or
  registered directly as a local package (`pi install ./companions/git`).
  A repo-root `companions/` directory in this repository is **not**
  auto-discovered or auto-loaded by Pi in any way; the only auto-loaded thing
  from this repo is `./extensions/pi-nobash.ts` via the root manifest.

### 2.4 Tool activation

Registering a `direct` tool activates it by default in stock Pi
(`docs/extensions.md` line 164). `pi-nobash` deliberately diverges via
`defaultActive: false` on all seven tools (amendment A12,
`docs/pi-nobash-technical-spec-amendments.md` line 230: loading the package
exposes no new tool until named in `defaultTools`, `--tools`, or the SDK
`tools` array). Companion tools must do the same. `exposure` options:
`"direct"`, `"model-only"`, `"callable"`, `"deferred"`, `"hidden"`
(`docs/extensions.md` lines 154–160). Dynamic activation is available via
`pi.setActiveTools()` (line 184).

---

## 3. Packaging boundaries

### 3.1 npm tarball

`package.json` `"files": ["assets", "extensions", "src", "README.md"]`.
Verified by running `npm pack --dry-run`: 27 files — README.md,
extensions/pi-nobash.ts, package.json, everything under `assets/` and `src/`.
**Not shipped:** `docs/` (including `docs/stacks/`), `tests/`, `scripts/`,
`biome.json`, `tsconfig.json`, `.mypi/`, `node_modules`. There is no build
step and no runtime dependency; the tarball is pure source.

### 3.2 Consequences

- Root README links into `docs/` are absolute GitHub URLs
  (`README.md` lines 113–118, 187, 198, e.g.
  `https://github.com/afshinator/pi-nobash/blob/main/docs/stacks/README.md`),
  enforced by `tests/unit/readme-links.test.ts`. Companion docs must keep this
  rule.
- Any companion code that should ship in the npm tarball must live under a
  `files`-allowed directory (`src/`, `extensions/`, `assets/`) or the
  allowlist must be extended. A GitHub-only `companions/` tree would not ship;
  that is consistent with the handoff's "maintained source/reference
  extensions, not published packages" preference, but it means a developer
  installing `pi-nobash` from npm gets **no** companion code.

  **Decision (plan FD2, 2026-10-12):** the `files` allowlist is extended with
  `companions`, so the tree ships and the npm install path matches a clone. This
  does not weaken D3: Pi reads only the root `pi` manifest (§2.2) and never
  auto-discovers a repo-root `companions/` (§2.3).
- `.pi/pi-nobash.json` does not exist in this repository (no `.pi/` directory
  on disk). It is a per-adopting-project configuration file; the handoff's D7
  templates now exist as copyable starting points under
  `docs/stacks/examples/` (written by the A2 planning run):
  `ts-node-npm.json`, `ts-node-pnpm.json`, `ts-expo-npm.json`,
  `python-venv.json`, `python-uv.json`. `.pi/pi-nobash.json` itself is not and
  should not be a repo file; it is per-adopting-project configuration.

---

## 4. Discrepancies: repository vs handoff

| # | Claim (handoff) | Verified reality |
|---|---|---|
| D-1 | §4 proposes a `companions/` tree (`companions/git`, `companions/javascript`, `companions/python`, `companions/files`, …) | Does not exist. `ls` of repo root: `assets`, `biome.json`, `docs`, `extensions`, `node_modules`, `package-lock.json`, `package.json`, `README.md`, `scripts`, `src`, `tests`, `tsconfig.json`. Handoff itself marks the tree non-binding. |
| D-2 | §4: `docs/stacks` recipes reference extensions that do not exist | Confirmed. `docs/stacks/typescript.md` (lines 18, 135), `python.md` (lines 11, 97), `README.md` (lines 64–110), `rust-go.md` (lines 99, 107) reference `my-js-tools.ts`, `my-git-tools.ts`, `my-fs-tools.ts`, `my-py-tools.ts`, `my-expo-tools.ts` — none exist anywhere on disk (`grep` across repo; only `extensions/pi-nobash.ts` exists). |
| D-3 | Handoff §3 lists `fs_copy`/`fs_move` (P2) and `fs_delete` (P2/deferred) as example tool lists | `docs/stacks/*.md` `--tools` lines already include `fs_copy`, `fs_move`, `fs_delete` in every stack's tool list and `docs/stacks/README.md` lines 95–97 document their schemas — presented as if selectable, though nothing implements them. Handoff §4 acknowledges the docs are aspirational; the inconsistency is real on disk today. |
| D-4 | D7: publish real copyable `.pi/pi-nobash.json` templates | Resolved during this planning run: `docs/stacks/examples/` now contains five copyable templates — `ts-node-npm.json`, `ts-node-pnpm.json`, `ts-expo-npm.json`, `python-venv.json`, `python-uv.json`. No repo-level `.pi/pi-nobash.json` exists; the templates are starting points to copy into an adopting project's `.pi/pi-nobash.json`, not active configuration. |
| D-5 | Package manager / tooling | Repo uses npm (`package-lock.json`), not pnpm/bun/yarn; test runner is `node --test` (not vitest/jest); no build step; `engines.node >=22.19.0`. Any companion plan must not assume vitest or a bundler. |
| D-6 | §2 mentions "SDK/session tool selection" | Verified in Pi docs (`docs/settings.md` line 40, `docs/extensions.md`); the repo itself documents the levers in README. No discrepancy, recorded for completeness. |
| D-7 | §4 layout shows `tests/` inside the proposed tree | `tests/` exists, but it is GitHub-only (not in the npm `files` allowlist — verified via `npm pack --dry-run`). |
| D-8 | Nested `companions/*/package.json` auto-discovery | Pi reads only the **root** `package.json` manifest when loading this repo as a package (`package-manager.js` `collectPackageResources`); nested manifests are honored only under scanned extension dirs (`.pi/extensions/`, `~/.pi/agent/extensions/`) or when a companion dir is itself registered as a package source. Companions under repo-root `companions/` cannot be auto-loaded. See §2.3. |
| D-9 | Handoff references Pi 1.1.0 APIs (`registerTool`, `tool_call` blocking, A12) | Confirmed against installed `@earendil-works/pi-coding-agent` 1.1.0 source and docs; repo `constants.ts` pins `TARGET_PI = "1.1.0"`. No discrepancy. |

### Not verified / unverified claims

- Whether Pi's `jiti` loader compiles `.ts` extension files identically for
  nested-directory packages (Pi docs say TypeScript extensions are supported;
  behavior for a symlinked `companions/` dir under `.pi/extensions/` was not
  runtime-tested here).
- Runtime behavior of `pi install ./local-package` against this repo
  (commands were not executed against a live `pi` binary; findings in §2 come
  from Pi's shipped source and docs).
- `mcp-server-go-quality` (handoff §6): README-observed only, per the handoff
  itself; no local clone exists to verify.

---

## Evidence commands run

- `ls` (repo root, `src`, `src/git`, `src/json`, `src/validation`,
  `extensions`, `docs`, `docs/stacks`, `tests/*`, `.mypi`)
- `cat package.json`, `cat biome.json tsconfig.json`
- `npm pack --dry-run` (tarball contents: 27 files, all under
  `assets/`, `src/`, plus README.md, extensions/pi-nobash.ts, package.json)
- `read` of `extensions/pi-nobash.ts`, `src/constants.ts`, `src/errors.ts`,
  `src/path-policy.ts`, `src/git/exec.ts`, `src/git/rev.ts`, `src/git/tools.ts`
  (partial), `src/git/index.ts`, `src/json/index.ts`, `src/config.ts` (partial),
  `src/validation/adapter.ts`, `src/validation/runner.ts` (partial),
  `src/pi-guard.ts`, `src/status.ts` (partial)
- `grep` for `my-*-tools.ts` and `fs_copy|fs_move|fs_delete` in `docs/stacks/`
- `node_modules/@earendil-works/pi-coding-agent`: `package.json`,
  `dist/core/pi-manifest.js`, `dist/core/package-manager.js`
  (`resolveExtensionEntries`, `collectAutoExtensionEntries`,
  `collectPackageResources`, resource-scanning block), `docs/packages.md`,
  `docs/settings.md`, `docs/cli.md`, `docs/extensions.md`
- `grep` of `docs/pi-nobash-technical-spec-amendments.md` for A12
