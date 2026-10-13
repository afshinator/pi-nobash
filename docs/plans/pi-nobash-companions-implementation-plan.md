# Companions implementation plan (task-plan-4)

**Status:** Plan for review — no companion code is implemented by this run.
**Amended 2026-10-13 (FD5):** backend selection (formatter, linter, package
manager) is **developer-owned project config** in `.pi/pi-nobash-companions.json`,
read once at session start — not an in-source constant. See FD5 and PD7.
**Inputs:** [repository inventory A1](./pi-nobash-repository-inventory.md) (facts,
paths, primitives — reused by reference, not copied here),
[companions handoff](../pi-nobash-stack-companions-handoff-2026-10-11.md) §3–§9,
[product spec v1.7.3](../pi-nobash-product-spec-v1.7.3.md) (G1–G7, AC1–AC11),
[amendments](../pi-nobash-technical-spec-amendments.md) A1–A14,
[stack docs](../stacks/README.md), [validation](../validation.md),
[tool reference](../tool-reference.md), [replacing Bash](../replacing-bash.md).

**Outputs owned by this plan:** companion source layout under `companions/`
(proposed; not yet written), check templates in `docs/stacks/examples/` (written
by this run), and the P0/P1 rows in `docs/ROADMAP.md`.

---

## Governing boundary

The model chooses a narrow, permitted operation with bounded typed arguments;
trusted code implements it via one fixed process invocation. No tool accepts a
program, executable, command, argv, script, entrypoint, or user-supplied flag
field. A missing operation returns `CAPABILITY_GAP` (via the `ToolError`
envelope, A5) — never a shell, interpreter, generic runner, or model-authored
config. Every companion tool registers `exposure: "direct"`,
`defaultActive: false` (A12), a one-line `promptSnippet`, and accurate
annotations (A11). Companion check templates and companion backend config are
developer-owned and read once at session start (A10); no mutation command
(`--fix`, `--write`, `git add`, dependency changes) ever appears in
`.pi/pi-nobash.json` (D6/PD6). Amendments
D1–D7 (handoff §1) are honored throughout and mapped in the Frozen decisions.

---

## Goal reconciliation

Every P0/P1 item names its goal, acceptance criterion, and the developer lever
it extends. Any item serving no goal is dropped from the plan.

| Item | Goal(s) | AC | Lever |
|---|---|---|---|
| `git_create_branch` | G2, G4, G6 | AC6, AC7, AC9 | Companion extension |
| `git_add` | G2, G4, G6 | AC6, AC7, AC9 | Companion extension |
| `git_commit` | G2, G4, G6 | AC6, AC7, AC9 | Companion extension |
| `git_push` | G2, G4, G6 | AC6, AC7, AC9 | Companion extension |
| `js_format_write` | G2, G4 | AC6, AC7 | Companion extension |
| `py_format_write` | G2, G4 | AC6, AC7 | Companion extension |
| `.pi/pi-nobash.json` templates (`docs/stacks/examples/`) | G2, G5 | AC6, AC10 | Checks configuration |
| `js_lint_fix` | G2, G4, G6 | AC6, AC7, AC9 | Companion extension |
| `py_lint_fix` | G2, G4, G6 | AC6, AC7, AC9 | Companion extension |
| `js_dep_add`, `js_dep_remove` | G2, G4 | AC6, AC7 | Companion extension |
| `expo_dep_add` | G2, G4 | AC6, AC7 | Companion extension |
| `py_dep_add`, `py_dep_remove` | G2, G4 | AC6, AC7 | Companion extension |
| A5 documentation relabeling | G5, G6 | AC1, AC9 | Documentation (no tool) |

Rationale in one line each: the Git mutations and formatters close the recorded
`git`/edit workloads (spec §8) as typed operations (G2) with defined effects
(G4); templates are the config-only half of the test/typecheck/lint coverage
(G5); lint fixes and dependency tools close the remaining frequent mutation
workloads while keeping every unsupported operation a visible gap (G6). The A5
doc pass is what makes adoption honest (G5) without widening any toolset.

---

## Frozen decisions

Each: decision, rationale, rejected alternatives. Amendment codes D1–D7 refer
to the handoff §1.

**FD1 — Companion layout and loading mechanism (D3, D2).**
Companions live in-repo under `companions/` as individually loadable reference
extensions:

```
companions/
  README.md            # copy/install instructions, load paths
  process.ts           # execFixed: the bounded fixed-argv runner (modeled on src/git/exec.ts)
  git/
    index.ts           # registerGitMutationTools(pi)
    create-branch.ts   # one tool per module, mirroring src/git/tools.ts conventions
    add.ts
    commit.ts
    push.ts
  javascript/
    index.ts           # registerJsTools(pi): js_format_write (P0); js_lint_fix, js_dep_add, js_dep_remove (P1)
  python/
    index.ts           # registerPythonTools(pi): py_format_write (P0); py_lint_fix, py_dep_add, py_dep_remove (P1)
  expo/
    index.ts           # registerExpoTools(pi): expo_dep_add (P1)
```

Companions import shared primitives from `src/` by **relative path whose depth
matches the file's location**: `companions/process.ts` (depth 1) uses
`../src/…`; every file under `companions/<area>/` (depth 2) uses `../../src/…`
(e.g. `../../src/git/exec.ts`, `../../src/path-policy.ts`, `../../src/errors.ts`,
`../../src/constants.ts`). Verified against the loader: `../src/…` from a depth-2
file fails with "Cannot find module"; the depth-2 form resolves. One tool per
module; one `registerX(pi)` per companion `index.ts`; no side effects at import
time (A1's entrypoint pattern).

Loading keeps the tree intact, so the relative imports hold:
`pi install ./companions/git` (local install, loaded in place) or
`pi -e <repo>/companions/git`. **Do not copy a single companion directory out of
the tree** — that is the only case where the relative imports break; this warning
ships in `companions/README.md`.

*Rationale:* zero duplication of the audited primitives (Ponytail), and A1 §2.3
proves repo-root `companions/` is **not** auto-discovered by Pi, so the layout
itself enforces "installing core loads no companion."
*Rejected:* separate npm packages per companion (D2 explicitly defers; a
published package invites auto-activation churn); nested `pi` manifests inside
`companions/*/package.json` (only honored under scanned extension dirs — a
second loading story to test for no gain); duplicating `path-policy.ts` into
each companion (drift from the audited implementation).

**FD2 — Distribution: ship companions in the npm tarball; core stays single-entry.**
`companions` is added to the `files` allowlist (`assets`, `companions`,
`extensions`, `src`, `README.md`), so every install route — npm, git, or local —
delivers the same thing: core plus reference companion source. The root
`package.json` `pi.extensions` manifest keeps exactly one entry
(`./extensions/pi-nobash.ts`, A14), and companion tools register
`defaultActive: false`, so a shipped companion is **inert until explicitly
loaded and selected**.

*Rationale:* shipping is **not** what enforces D3 — A1 §2.2/§2.3 verified that Pi
reads only the root `pi` manifest (never nested ones) and never auto-discovers a
repo-root `companions/`; the single-entry manifest does that job with or without
the files present. Including the source makes the npm install path equivalent to
a clone, removes a second acquisition step from a developer who already chose to
adopt the package, and pins companions to the release version rather than an
unversioned GitHub `main`. The size cost is a few KB of source.
*Rejected:* GitHub-only companions (a dev who installed via npm would need a
second acquisition path, and the copy would be version-skewed); separate
published packages `pi-nobash-git` etc. (new release surface, D2 defers it).

**FD3 — `git_push` semantics.**
`git_push { remote?: string; setUpstream?: boolean }` pushes the **current**
branch to a **configured** remote with no refspec, no force, and at most one
flag:

1. Resolve the current branch via `git rev-parse --abbrev-ref HEAD`; detached
   HEAD → `GIT_FAILED` ("detached HEAD; switch to a branch first").
2. Default remote `origin`; a model-supplied `remote` must match an existing
   remote (`git remote` list), else `INVALID_ARGUMENT`. No remote creation.
3. `git rev-parse --abbrev-ref --symbolic-full-name <branch>@{upstream}` — if it
   fails and `setUpstream` is not set, fail with `GIT_FAILED` naming the missing
   upstream.
4. `setUpstream: true` (default false) selects the second argv shape,
   `git push --set-upstream <remote> <branch>` — the only flag, chosen by an
   explicit boolean the model sets.
5. Invocation: `git push [--set-upstream] <remote> <branch>` — branch name only,
   never `<src>:<dst>`, never `--force`/`--force-with-lease`, never tags, never
   wildcards. Non-fast-forward rejection surfaces as `GIT_FAILED` with git's
   stderr.

*Rationale:* push is the only operation landing on shared state (handoff §3
guardrails); the contract stays narrow while completing the recorded
create-branch → commit → push workflow. Without `setUpstream`, the first push of
every new branch requires a shell — the outcome the package exists to avoid.
Setting upstream writes local branch config; it is not remote creation.
*Rejected:* dropping `setUpstream` (forces a manual shell step on the common
path); arbitrary refspec or `--force` variants (forbidden by the handoff); remote
creation (a configuration mutation, not a push).

**FD4 — Staging modes.**
`git_add` supports two modes, each a fixed invocation:

- `git_add { paths: string[] }` — explicit paths: `git add -- <validated paths>`,
  where a path may be a file or a **directory** (verified: a directory path stages
  its whole subtree under `GIT_LITERAL_PATHSPECS=1`). Paths are literal: no glob
  expansion (verified: `*.txt` under literal pathspecs matches nothing), no
  `:(glob)`, no `:!` exclusions.
- `git_add { trackedOnly: true }` — `git add -u`: stages modifications and deletions
  of already-tracked files, and **cannot** introduce an untracked file.

No `-A`/all mode: adding untracked files is the one behavior that can include
something the model never enumerated (a secret, a build artifact, a scratch file),
which is the accidental-inclusion class this package exists to prevent. A request
to stage everything is a `CAPABILITY_GAP` naming the missing mode.

*Rationale:* the recorded workflow (assessment §2.3) stages *specific* changes, so
explicit paths are the evidenced need, and directory paths keep that practical for
large refactors. `trackedOnly` is a bounded, explicit mode (handoff §3 permits it as
a deliberately enabled mode) that serves "stage my modifications" without new files.
*Rejected:* `-A`/all (unbounded inclusion); a single `mode` enum hiding the
granularity (the two modes are separate argv shapes, declared not implied —
`trackedOnly` is a boolean, not a route to `-A`).

**FD5 — Formatter, linter, and package-manager backends are developer-owned
project config, read once (A10).**
The backend for each stack companion is selected by the developer in
`.pi/pi-nobash-companions.json`, read **once per session at session start**
(amendment A10 semantics: the `session_start` handler, session-id keyed,
immutable for that session, foreign-cwd calls rejected) and validated at load
with a clear `PARSE_ERROR` (bad JSON, unknown key, non-enum value). The model
**never** picks a backend: it is configuration, not a tool parameter — no
schema field, no flag, no executable path, in any tool.

Config values are **enumerated names, never executables**: trusted companion
code maps each name to a fixed program and fixed argv shape (`npx prettier`,
`npx biome`, `npx eslint`, `ruff`, `npm`, `uv`). A value outside the enum is
rejected at session start. This keeps the A10 composition route closed even for
a session holding Pi `write`/`edit`: rewriting the config can only switch among
the enumerated backends, never introduce an arbitrary command.

Schema (one file, one schema; all keys optional; unknown keys → `PARSE_ERROR`):

```json
{
  "companions": {
    "javascript": { "formatter": "prettier", "linter": "biome", "packageManager": "npm" },
    "python": { "formatter": "ruff", "linter": "ruff", "packageManager": "uv" }
  }
}
```

P0 reads only `formatter` (defaults `prettier`, `ruff`); P1 adds `linter`
(default `biome`) and `packageManager` (defaults `npm`, `uv`). P0/P1 enum
members: `javascript.formatter` ∈ {`prettier`,`biome`},
`javascript.linter` ∈ {`biome`,`eslint`}, `javascript.packageManager` ∈ {`npm`},
`python.formatter`/`python.linter` = `ruff` only, `python.packageManager` =
`uv` only (FD6). The enum is the extension point for a future reviewed backend
(A7-4, A7-5) — never a model input.

Invocations (fixed per selected backend): Prettier
`npx prettier --write -- <files>`; Biome format `npx biome format --write -- <files>`;
Biome lint `npx biome check --write -- <files>`; ESLint
`npx eslint --fix -- <files>`; Ruff format `ruff format -- <files>`; Ruff lint
`ruff check --fix -- <files>`.

*Rationale:* a companion is loaded **in place** from the package (FD1), so an
in-source constant is developer-owned only if the companion is vendored — which
contradicts load-in-place and is overwritten by the next package upgrade. A
project config file survives upgrades and is version-controlled with the
project, so the developer's choice is durable. docs/stacks/typescript.md names
Prettier and Biome as the two established choices; Ruff is the docs' sole
Python formatter.

**File choice (why not inside `.pi/pi-nobash.json`).** A top-level `companions`
key in the existing `.pi/pi-nobash.json` is **rejected for this run**: core
`src/config.ts` `parseConfig` rejects any unknown top-level key (`unknown
top-level config keys: …`, asserted by `tests/unit/config/config.test.ts`), so
adding `companions` there would break `run_validation` in every adopting project
unless **core** `src/config.ts` changed — which this run's write scope forbids.
The sibling file keeps core untouched and keeps PD7's "no companion reads
`.pi/pi-nobash.json`" true verbatim. Revisit only if a core change is separately
authorized.

*Rejected:* the in-source one-line constant (lost on package upgrade; not
version-controlled with the project); `backend: "prettier" | "biome"` schema
field (model-supplied backend selection); a config value naming an executable
path or argv (arbitrary-execution surface — the validated enum is what makes
config safe); a top-level `companions` key in `.pi/pi-nobash.json` (breaks core
config parsing unless core changes; see File choice).

**FD6 — Initial package-manager coverage.**
- Checks templates (config, P0): npm, pnpm (TS/Node); Expo via npx; Python via
  venv/PATH and uv. Yarn/bun/Poetry/pipenv remain documented transforms in
  docs/stacks (change `program`/`args` only), not separate template files.
- Lint fixes (P1): the tool spawns the project-local binary the same way the
  formatter does — `npx biome check --write`/`npx eslint --fix` per the
  configured `javascript.linter` (default `biome`), `ruff check --fix` for
  Python. Safe fixes only; no `--unsafe-fixes` (separate tool if ever justified
  — P2).
- Dependency tools (P1): **npm** for `js_dep_add`/`js_dep_remove`
  (`npm install`/`npm uninstall`, always with `--ignore-scripts`), **expo** for
  `expo_dep_add` (`npx expo install`), **uv** for `py_dep_add`/`py_dep_remove`
  (`uv add [--dev]` / `uv remove`). One backend each, fixed argv, no
  model-supplied flags. pnpm/yarn/bun/Poetry/pipenv variants are
  `CAPABILITY_GAP` until a separately reviewed backend is added to the config
  enum (FD5).
- `run_validation` target adapters: unchanged — `node_test` is the only
  verified adapter (A7); templates use `targets.mode: "none"` everywhere else.

*Rationale:* repo itself uses npm + uv-era Python tooling; handoff §3 says
"begin with one well-supported workflow" for Python deps. Each additional
variant is a new fixed-argv builder plus lifecycle analysis — added only on
need.
*Rejected:* shipping every manager variant up front (untestable surface,
handoff explicitly warns); `pip install` as a Python dep tool (no lockfile
semantics — the mutation is unreviewable); `npx <pkg>` as a dep tool (npx
fetches and runs arbitrary package code — a generic runner by another name).

**PD7/D6 restated — no generic execution route.** No companion reads
`.pi/pi-nobash.json` (the core validation config) or executes anything from it;
the only file a companion reads is its own `.pi/pi-nobash-companions.json`,
whose values are enumerated backend names that trusted code maps to fixed argv
(FD5) — never a program, path, or argument string. No companion exposes a
command/argv/script field, no package-manager `run`/`exec` script invocation
exists in any companion (`npm install` lifecycle scripts are disabled with
`--ignore-scripts`), and linter fixers get enumerated safe-fix modes only. The
proving tests are in A6 (`no-command-field` rows + `core-no-companion-exposure`
+ the config-enum rows).

---

## Ponytail assessment (per decision)

| Decision | Smallest complete design | Deliberately skipped |
|---|---|---|
| FD1 layout | 4 dirs, 1 shared runner module, depth-correct relative imports into audited `src/` | Vendored copies, per-companion `package.json`, build step, import rewriting |
| FD2 distribution | Add `companions` to `files`; manifest stays single-entry | A second acquisition path, per-companion packages |
| FD3 push | Resolve branch → validate remote → `git push [--set-upstream] <remote> <branch>` | refspec, force variants, remote creation |
| FD4 staging | `git add -- paths` (file or directory) plus `git add -u` | `-A`/all, pathspec globs, a granularity enum |
| FD5 backends | Project config (`.pi/pi-nobash-companions.json`) read once at session start + one fixed argv builder per enum member | In-source constant, schema field, config value naming an executable/argv, auto-detection, plugins |
| FD6 managers | npm/expo/uv only | yarn, bun, pnpm dep tools; Poetry/pipenv |
| Shared runner | `companions/process.ts` (~40 lines, modeled on `execGit`) | New dependency (execa etc.) — stdlib `child_process` only |
| Schema bounds | Reuse `src/constants.ts` caps; add `MAX_FORMAT_PATHS = 50` | Per-tool configurable limits |

New dependencies: **none.** Companions use `node:child_process`, `typebox`
(peer), and `@earendil-works/pi-coding-agent` (peer). Prettier/Biome/Ruff/
expo-CLI/uv/npm are pre-existing project tooling resolved via `npx`/PATH — not
dependencies of this package.

---

## (A2) P0 implementation plan

Shared module first, then per-tool contracts. All tools: fixed argv, no shell,
per-stream 100 KB output caps with `truncated` flag, AbortSignal support
(cancellation kills the child), fixed per-tool timeouts, `ToolError` envelope,
`details` shapes frozen below (A6-style contract). All tools annotate
`readOnlyHint: false` (they mutate); `destructiveHint: true` only on `git_push`
(lands on shared state) — plain mutations stay honest without fear-mongering.

### Shared: `companions/process.ts`

`execFixed(program, args, cwd, opts?)` — `spawn(program, args, { shell: false })`,
100 KB per-stream accumulation + `truncated`, timeout via
`AbortSignal.timeout(opts.timeoutMs)` wired to `child.kill()`, resolves
`{ code, stdout, stderr, truncated, timedOut }`. Non-zero exit is returned, not
thrown — callers decide `GIT_FAILED` vs `VALIDATION_FAILED`-style codes.
Mirrors `src/git/exec.ts`; ~40 lines, stdlib only.

### Shared: `companions/config.ts` (FD5)

`loadCompanionConfig(dir)` reads `.pi/pi-nobash-companions.json` under the
session cwd and validates the schema. Missing file → defaults (`prettier`,
`ruff` for P0). Unknown key, non-enum value, or malformed JSON →
`ToolError("PARSE_ERROR", …)`. Read **once at session start** using the
`session_start` handler pattern of `src/validation/index.ts` (session-id keyed
map, `session_shutdown` cleanup); the registration-cwd read is the
direct-caller fallback, exactly as core treats `.pi/pi-nobash.json`. A call
whose `ctx.cwd` differs from the bound session cwd is rejected
(`INVALID_ARGUMENT`, "no companion config loaded for this workspace"). The
module maps each enum member to a fixed `{ program, args }` builder; config
never supplies an executable path. ~60 lines, stdlib only.

### P0-1 `git_create_branch` — `companions/git/create-branch.ts`

- **Schema (TypeBox):**
  ```ts
  Type.Object({
    name: Type.String({ description: "new branch name" }),
    startPoint: Type.Optional(Type.String({ description: "existing commit or branch to branch from" })),
    switchTo: Type.Optional(Type.Boolean({ default: true })),
  })
  ```
  No other fields. Bounds: `name` ≤ 255 chars.
- **Validation:** branch name against the same conservative charset as
  `validateCommitRevision` (no whitespace, no leading `-`, no `..`, no `@{`,
  no `~`/`^`/`:`/`\`, reject `refs/`-escape tricks) plus Git refname rules;
  reject if the branch already exists (`git rev-parse --verify --quiet refs/heads/<name>`);
  `startPoint`, if present, goes through `validateCommitRevision` (must resolve
  to a commit). Name/startPoint never placed after `--`.
- **Invocation:** `switchTo` (default true): `git switch -c <name> [<startPoint>]`;
  otherwise `git branch <name> [<startPoint>]`. Two fixed argv shapes.
- **Effects/limits:** creates one ref in the local repo; nothing staged,
  committed, or pushed; working tree untouched (create from non-HEAD start point
  with dirty tree is left to git's own refusal, surfaced as `GIT_FAILED`).
  Timeout 30 s. Reused: `execGit`, `validateCommitRevision`.
- **`details` (frozen):** `{ branch: string; switchedTo: boolean; startPoint?: string }`.
- **Tests (A6 ref `git_create_branch`):** happy create+switch, create without
  switch, from `startPoint`; failures: duplicate name, invalid name (`-b`, `..`,
  whitespace), unresolvable startPoint, detached-HEAD create is allowed (branch
  from HEAD) but switch from detached is a plain switch — covered in fixtures.

### P0-2 `git_add` — `companions/git/add.ts`

- **Schema (two modes, exactly one required):**
  ```ts
  Type.Object({
    paths: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 100 })),
    trackedOnly: Type.Optional(Type.Boolean({ default: false })),
  })
  ```
  `paths` and `trackedOnly: true` are mutually exclusive; neither or both →
  `INVALID_ARGUMENT`.
- **Validation:** every path via `validateGitPaths`/`validateWorkspacePath`
  semantics (A1 table): relative to repo root, no absolute paths, no `..`
  traversal, no NUL, no option-like final segments, and no path whose first
  path segment begins with `:` (pathspec magic — `:(glob)`, `:!`, `:(top)`) →
  `INVALID_ARGUMENT`; ≤ 100 paths. A path may name a file **or a directory**;
  both are literal paths (a directory stages its subtree).
- **Invocation (two fixed shapes):**
  - explicit paths: `git add -- <paths…>` on the session cwd, with the child
    environment set to `GIT_LITERAL_PATHSPECS=1` (`execFixed`/`execGit` merge the
    var into `spawn`'s `env`). `--` ends option parsing but does **not** disable
    pathspec magic; `GIT_LITERAL_PATHSPECS=1` is what makes every path literal —
    no glob/pathspec expansion, no `:!` exclusions.
  - tracked-only: `git add -u` (no paths).
- **Effects/limits:** index-only mutation; in explicit-path mode a new untracked
  file named explicitly is staged (that is the point of explicit paths); in
  tracked-only mode only already-tracked modifications and deletions are staged,
  and no untracked file can be added. `.gitignore`d files refuse per git,
  surfaced as `GIT_FAILED`. Timeout 30 s.
- **`details` (frozen):** `{ staged: string[]; truncated: boolean }` — parsed
  from `git diff --cached --name-only` after the add (bounded to the same
  100-path / 100 KB caps).
- **Tests:** stages exactly the named files (byte-exact index diff via
  `git diff --cached --name-only` before/after); untracked explicit file staged;
  a **directory path** stages its whole subtree; a **glob** (`*.txt`) matches
  nothing and is reported (literal pathspecs); `trackedOnly: true` stages a tracked
  modification but **not** an untracked file; rename staged as rename; failures:
  `..`, absolute, symlink-escape, option-like segment, `:`-magic first segment,
  ignored file, nonexistent path, and `paths` supplied together with
  `trackedOnly: true`.

### P0-3 `git_commit` — `companions/git/commit.ts`

- **Schema:**
  ```ts
  Type.Object({
    message: Type.String({ minLength: 1, maxLength: 4000 }),
  })
  ```
- **Validation:** non-empty staged index required — pre-check
  `git diff --cached --name-only` (empty → `INVALID_ARGUMENT` "nothing staged;
  stage paths with git_add first"). The tool never stages, never `-a`, never
  amends.
- **Invocation:** `git commit -m <message>` — message as a single argv element;
  no `-m` repetition games, no `--no-verify`, no `--author`, no dates.
- **Effects/limits:** creates one commit on the current branch from the staged
  index. Repository hooks (`pre-commit`, `commit-msg`) run — a documented,
  deliberate effect (repo-trusted code; no bypass flag is offered). GPG/SSH
  signing follows repo config. Hook or signing failure → `GIT_FAILED` with
  stderr. Timeout 120 s (hooks can be slow). Commit-message body via `\n` in the
  single string is allowed (git handles it; no shell involved).
- **`details` (frozen):** `{ hash: string; shortHash: string; branch: string|null;
  filesCommitted: number; message: string }` (hash from `git rev-parse HEAD`
  post-commit).
- **Tests:** commit of staged pair → exactly one commit, correct tree, message
  byte-equal, filesCommitted correct; empty index rejected **before** invoking
  git; hook failure surfaces as `GIT_FAILED` (fixture repo with failing
  `pre-commit`); no-auto-stage proof: modified-but-unstaged file does not appear
  in the commit.

### P0-4 `git_push` — `companions/git/push.ts`

Contract frozen in FD3. Schema:

```ts
Type.Object({
  remote: Type.Optional(Type.String({ maxLength: 100 })),
  setUpstream: Type.Optional(Type.Boolean({ default: false })),
})
```

- **Invocation (fixed sequence):**
  1. `git rev-parse --abbrev-ref HEAD` → current branch (detached → `GIT_FAILED`)
  2. if `remote` given: `git remote` list must contain it, else `INVALID_ARGUMENT`
  3. `git rev-parse --abbrev-ref --symbolic-full-name <branch>@{upstream}` — if it
     fails and `setUpstream` is not set → `GIT_FAILED` "no upstream for <branch>;
     pass setUpstream: true or run git push --set-upstream once"
  4. `git push [--set-upstream] <remote=origin> <branch>` — the only optional flag,
     selected by the explicit `setUpstream` boolean
- **Effects/limits:** mutates shared remote state — `destructiveHint: true`.
  Non-fast-forward/rejected push = `GIT_FAILED` with git's stderr (never
  retried with force). No refspec, no force, no tags, no remote creation, no
  URL in argv ever. Timeout 300 s (network). Stdout/stderr caps as usual.
- **`details` (frozen):** `{ remote: string; branch: string; pushed: true }`.
- **Tests (throwaway bare repo as `origin`):** happy push of a local commit;
  push of second commit; `setUpstream: true` sets tracking on a new branch (the
  only argv shape with a flag: `["push","--set-upstream",remote,branch]`); a
  brand-new branch without `setUpstream` fails `GIT_FAILED`; non-fast-forward
  (remote advanced) fails with `GIT_FAILED` and remote unchanged; no-force proof:
  rejected push leaves remote tip unchanged and the arg-builder test asserts the
  argv contains no force flag for either shape; unknown remote rejected; detached
  HEAD rejected.

### P0-5 `js_format_write` — `companions/javascript/format-write.ts`

- **Schema:**
  ```ts
  Type.Object({
    paths: Type.Array(Type.String(), { minItems: 1, maxItems: 50 }),
  })
  ```
  (`MAX_FORMAT_PATHS = 50` in the companion; no other fields — no backend, no
  flags, no config path.)
- **Validation:** every path via `validateWorkspacePath` (realpath
  containment, `..`/symlink-escape/absolute rejection), must exist as a regular
  file, extension must be one of the backend's handled set (Prettier:
  `.ts .tsx .js .jsx .json .css .md …` — fixed list in the module; Biome: its
  supported set). Unknown extension → `INVALID_ARGUMENT` before spawn.
- **Invocation (FD5):** backend from `companions.javascript.formatter`
  (default `prettier`), read once at session start — Prettier
  `npx prettier --write -- <resolved paths…>`; Biome
  `npx biome format --write -- <resolved paths…>`. Spawned by `execFixed`,
  `cwd` = session cwd, shell false.
- **Effects/limits:** rewrites the named files in place only. No config file is
  read *by the tool* beyond the formatter's own project config discovery
  (`prettier.config`/`biome.json` — documented; the model cannot point the tool
  at another config). Timeout 120 s; output truncated at 100 KB/stream;
  per-file results parsed from formatter stdout where stable (`prettier` lists
  files) — `details` reports `{ formatted: string[]; truncated: boolean }` with
  a conservative parse (unparseable output still returns exit-code-based
  success/failure).
- **Tests:** exact pre/post byte diff on a fixture file with known
  unformatted content (diff is exactly the formatted form, other files
  untouched); out-of-scope path rejected (`..`, symlink, absolute); option-like
  filename rejected; `node_modules` path inside workspace rejected (fixed deny
  list: `node_modules`, `.git`, `dist`, `build`); timeout produces `TIMEOUT`
  with partial effects documented; the configured backend produces exactly the
  frozen argv (arg-builder unit test); no config file → Prettier default; a
  non-enum `formatter` value or unknown key → `PARSE_ERROR` at session start;
  the session-start read wins over a mid-session config edit.

### P0-6 `py_format_write` — `companions/python/format-write.ts`

Same shape as P0-5 with fixed Ruff backend:

- **Schema:** identical `{ paths: string[] }`, 1..50.
- **Validation:** `validateWorkspacePath`, regular file, extension
  `.py`/`.pyi`.
- **Invocation:** backend from `companions.python.formatter` (enum: `ruff`,
  default `ruff`) — `ruff format -- <resolved paths…>` via `execFixed` (Ruff
  format writes by default; `--` separates validated paths). `ruff` resolved
  from PATH/project venv — same interpreter assumption as the python-venv
  checks template; documented in the module header.
- **Effects/limits:** rewrites named files per Ruff format semantics; project
  `pyproject.toml` `[tool.ruff]` config is honored by Ruff itself (line length
  etc. — the tool passes no formatting flags). Timeout 60 s; same truncation
  and `details` shape as P0-5.
- **Tests:** exact pre/post diff fixture; scope rejections as P0-5; argv
  exactly `["format", "--", ...paths]`; failure codes as frozen for all
  formatters (Prettier, Biome, Ruff): non-zero exit returns an `isError` result
  with code `VALIDATION_FAILED` (A5 semantics); timeout returns `TIMEOUT`.

### P0-7 Check templates (`docs/stacks/examples/`) — written by this run

Five copyable, valid-JSON, Biome-clean `.pi/pi-nobash.json` starting points.
These are **configuration** (lever 2), not tools: every check is read-only, all
use `targets.mode: "none"` except the `node_test` file-target check, and no
template contains a mutating command.

| File | Stack/variant | Assumptions (stated per FD6) |
|---|---|---|
| `ts-node-npm.json` | Node/web, npm | `package.json` scripts `test`, `typecheck`, `lint`, `format:check`; tests via `node:test`; `format:check` is a non-mutating formatter check |
| `ts-node-pnpm.json` | Node/web, pnpm | same scripts; pnpm on PATH |
| `ts-expo-npm.json` | Expo/React Native, npm | jest-expo `test` script accepting `--ci`; `expo`, `prettier`, `expo-doctor` via npx; no `bundle` check (slow, writes a build dir — developer adds it per docs/stacks/typescript.md) |
| `python-venv.json` | Python, venv/PATH | `pytest`, `mypy`, `ruff`, `python -m build` on PATH in the agent's environment |
| `python-uv.json` | Python, uv | `uv` on PATH; tools run inside the project environment via `uv run` |

Common assumptions for all five: file is placed at the **workspace root**
`.pi/pi-nobash.json`; `cwd: "."` is the workspace root; timeouts are generous
defaults to be tuned per repo; check names (`unit`, `typecheck`, `lint`,
`format_check`, `unit_file`, `doctor`, `build`) are the stable vocabulary the
agent sees. Yarn/bun/Poetry/pipenv variants: derive by changing `program`/`args`
per the tables in `docs/stacks/{typescript,python}.md` — not shipped as files
(FD6). Verified: `npx biome check docs/stacks/examples/` → clean; all five are
parseable by `src/config.ts`'s `ValidationCheck` shape.

### P0 milestones (ordered slices)

1. **M0 — Distribution:** add `companions` to `package.json` `files` and a test
   that the packed tarball includes the companion source while loading core
   registers no companion tool (FD2).
2. **M1 — Shared runner + Git core:** `companions/process.ts`,
   `companions/git/{index,create-branch,add,commit}.ts` + registration test +
   git fixtures. Proves the companion loads alongside core with zero
   `defaultActive` tools active.
3. **M2 — `git_push`:** `companions/git/push.ts` + bare-remote fixtures
   (upstream, rejection, no-force).
4. **M3 — Formatters:** `companions/config.ts` (schema, session-start read,
   enum→argv builders), `companions/javascript/format-write.ts`,
   `companions/python/format-write.ts` + byte-diff and config-validation
   fixtures.
5. **M4 — Templates + docs:** templates (done — this run), A5 relabeling of
   `docs/stacks/*.md` links to the companions and templates.

Each slice: `npm run typecheck && npm test && npx biome check .` green before
the next.

---

## (A3) P1 plan — lint fixes and dependency mutations

All P1 tools reuse the P0 skeleton (`execFixed`, `validateWorkspacePath`,
envelope, bounds). Safe-mode-first, fixed backends, no model flags.

### P1-1 `js_lint_fix` — `companions/javascript/lint-fix.ts`

- **Schema:** `{ paths: string[] }` (1..50), same validation as P0-5.
- **Invocation (backend from `companions.javascript.linter`, default
  `biome`):** Biome: `npx biome check --write -- <paths>` (safe fixes only —
  Biome's `--write` applies safe fixes; unsafe require `--unsafe`, which is
  never emitted). ESLint: `npx eslint --fix -- <paths>` (safe fixes by
  default).
- **Modes:** safe only. Unsafe fixes are a **separate, not-yet-designed** tool
  (`js_lint_fix_unsafe` candidate, P2) — never a flag on this one (handoff:
  "review safe/unsafe modes separately").
- **Lifecycle/side effects:** none beyond file rewrites — `biome`/`eslint`
  binaries do not run project scripts, no network, no lockfile. Config
  discovery (`biome.json`/`eslint.config.js`) is the formatter's own; ESLint
  config is project-controlled *code* executed by ESLint — a documented
  trusted-repo effect, same class as test runners (spec §4.3).
- **`details`:** `{ fixed: string[]; remainingIssues: boolean; truncated: boolean }`
  (from linter output; conservative parse).
- **Never via `run_validation`:** the `lint` check stays report-mode; a template
  containing `--write`/`--fix` fails a template-lint test (A6).

### P1-2 `py_lint_fix` — `companions/python/lint-fix.ts`

- **Schema:** `{ paths: string[] }` (1..50), `.py`/`.pyi`.
- **Invocation:** `ruff check --fix -- <paths>` — safe fixes only; the module
  never emits `--unsafe-fixes`. (Ruff's default `--fix` applies safe fixes.)
- **Side effects:** file rewrites only; no network, no scripts. Ruff config
  discovery from `pyproject.toml`/`ruff.toml` — documented.
- **`details`:** as P1-1.

### P1-3 `js_dep_add` / P1-4 `js_dep_remove` — `companions/javascript/dep.ts`

- **Schema:**
  ```ts
  // js_dep_add
  Type.Object({
    packages: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
    dev: Type.Optional(Type.Boolean()),
  })
  // js_dep_remove
  Type.Object({ packages: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }) })
  ```
- **Package-name validation (the load-bearing control):** npm name grammar —
  scope `@scope/name` or bare name, lowercase, charset `[a-z0-9._-]`, length
  ≤ 214, no leading `.`/`-`, **no version specifiers, ranges, URLs, git
  specifiers, or aliases** (`pkg@version`, `pkg@next`, `github:user/repo`,
  `npm:pkg@ver` → `INVALID_ARGUMENT`). The tool installs the version the
  project's registry resolves — never a model-chosen version or tarball. Names
  never after `--` (npm install has no `--` separator need; argv is fixed).
- **Invocation:** package manager from `companions.javascript.packageManager`
  (enum: `npm`, default `npm`; FD5) — `npm install [--save-dev] <names…>` /
  `npm uninstall <names…>`, **always plus `--ignore-scripts`**.
- **`--ignore-scripts` decision (frozen):** required. `npm install` runs
  `preinstall`/`postinstall` lifecycle code from the installed package —
  arbitrary execution by another name and the exact composition route PD6
  bans. `--ignore-scripts` is a fixed argv element the model cannot remove.
  Known cost: packages legitimately needing install scripts (native builds,
  `husky init`) break — the documented remedy is the developer running install
  once by hand. Rejected alternative: allowlisting lifecycle scripts
  (`npm config set ignore-scripts` + per-package allow) — npm has no reliable
  per-package allow mechanism; machinery, not capability.
- **Other side effects:** rewrites `package.json` + `package-lock.json`
  (reviewable diff via `git_diff`); **network access** (registry fetch);
  no `--force`, no `--legacy-peer-deps`, no registry override. Timeout 300 s.
  pnpm/yarn/bun: `CAPABILITY_GAP` until added to the `packageManager` enum
  (FD5/FD6).
- **`details`:** `{ packages: string[]; dev: boolean; manifestUpdated: true }`.

### P1-5 `expo_dep_add` — `companions/expo/dep-add.ts`

- **Schema:** `{ packages: string[] }` (1..20), same name grammar.
- **Invocation:** `npx expo install <names…>` — the SDK-compatible version
  resolver. **Never `npm install`** for Expo packages (docs/stacks/typescript.md
  caveat): plain install takes latest and can break the SDK matrix. No `--` or
  extra flags; `--ignore-scripts` is **not** passed here because `expo install`
  is the supported path and may run package scripts — documented effect, and
  the reason this is its own tool with its own description rather than a flag
  on `js_dep_add`.
- **Side effects:** `package.json` + lockfile rewrite, network, possible
  lifecycle scripts (documented, Expo-blessed path). Timeout 600 s.
- **`details`:** `{ packages: string[] }`.

### P1-6 `py_dep_add` / P1-7 `py_dep_remove` — `companions/python/dep.ts`

- **Schema:** as P1-3/P1-4 (`packages` 1..20, `dev` on add).
- **Package-name validation:** PEP 508 name grammar —
  `[A-Za-z0-9._-]+`, no extras, no version specifiers, no URLs, no VCS links
  (`pkg>=2`, `pkg @ file://…`, `git+https://…` → `INVALID_ARGUMENT`). uv
  resolves the version.
- **Invocation:** package manager from `companions.python.packageManager`
  (enum: `uv`, default `uv`; FD5) — `uv add [--dev] <names…>` /
  `uv remove <names…>`.
- **Side-effect analysis:** rewrites `pyproject.toml` + `uv.lock`
  (reviewable diff); network (PyPI fetch); **uv does not run arbitrary
  lifecycle scripts on add** (uv installs wheels; build isolation runs the
  package's build backend — `pdm`/`setuptools` build code, not install-time
  scripts of the dependency). No `--index-url`/extra-index flags, no
  extras (`pkg[foo]` rejected with the name grammar). Timeout 300 s.
- **Poetry/pipenv:** `CAPABILITY_GAP` until added to the `packageManager` enum
  (FD5/FD6). `pip install`: rejected in FD6 —
  no lockfile mutation to review.
- **`details`:** `{ packages: string[]; dev: boolean }`.

### P1 lifecycle/side-effect matrix

| Tool | Network | Lifecycle scripts | Lockfile | Manifest | Other writes |
|---|---|---|---|---|---|
| `js_lint_fix` | no | no | no | no | named files only |
| `py_lint_fix` | no | no | no | no | named files only |
| `js_dep_add` | registry | **blocked** (`--ignore-scripts`, frozen) | `package-lock.json` | `package.json` | — |
| `js_dep_remove` | no (local resolution) | n/a | `package-lock.json` | `package.json` | — |
| `expo_dep_add` | registry + SDK resolution | possible (Expo-blessed path; documented) | project lockfile | `package.json` | — |
| `py_dep_add` | PyPI | build-backend only, no install scripts | `uv.lock` | `pyproject.toml` | `.venv` update |
| `py_dep_remove` | no | n/a | `uv.lock` | `pyproject.toml` | `.venv` update |

### P1 milestones

5. **M5 — lint fixes** (`js_lint_fix`, `py_lint_fix`) + fixtures.
6. **M6 — JS/Expo deps** (`js_dep_add`, `js_dep_remove`, `expo_dep_add`) with
   the name-grammar test suite and `--ignore-scripts` argv assertion.
7. **M7 — Python deps** (`py_dep_add`, `py_dep_remove`).

---

## Deferred: A4 Go diagnostics reuse

**No Go integration was built or will be built by this run.** The evaluation
question — adopt, adapt, or defer
[`mcp-server-go-quality`](https://github.com/afshinator/mcp-server-go-quality)
as a Go diagnostics companion — is recorded on the ROADMAP Later/Evaluation
list with the full seven-item review checklist from handoff §6:

1. automatic `install_tools` must never be exposed as a read-only check or run
   silently (installation is a separate, developer-controlled mutation);
2. its developer-configured `extra_args` must never become model-supplied argv
   — review config ownership and session-load behavior (an agent with
   `write`/`edit` must not be able to author argv that a later check executes,
   per the A10 composition route);
3. the model may choose only enumerated diagnostics/check subsets and bounded
   scope — no free-form process, command, argv, script, or executable path;
4. verify side effects: caches, tool/binary downloads, vulnerability-DB
   network access, file writes, project-controlled code;
5. confirm Pi integration (MCP is not a Pi extension; adapter or Pi-native
   rewrite required);
6. constrain workspace roots, output cardinality, `native` payload size,
   cancellation, startup cost;
7. review license, pinning/reproducibility, and adapt-vs-depend.

**Reason for deferral:** it requires read-only source and network review of an
external repository, which this run cannot perform; its diagnostics are
read-only and do not block any P0/P1 item. Everything README-observed about the
server is unverified (A1 §Not-verified). If Go diagnostics prove deliverable
through developer-named `run_validation` checks instead, prefer that and skip
the server (smallest-design rule).

---

## (A5) Documentation and migration plan

1. **Label every described tool implemented vs proposed.** In
   `docs/stacks/{README,typescript,python,rust-go}.md`, each tool table gains a
   **Status** column: `core` (shipped), `companion — planned (P0/P1)` linking
   the plan, or `proposed` (fs_*, rust_*, go_*, `git_rm_cached`). No described
   operation may read as shipped before its companion lands.
2. **Replace `my-*-tools.ts` placeholder references with the real companions.**
   Once a companion lands, its stack doc links
   `companions/<stack>/` on GitHub (absolute URLs — README-link rule,
   `tests/unit/readme-links.test.ts` stays green) and shows the actual
   `-e ./companions/<stack>` load line. Until then the placeholder stays, named
   as such.
3. **Link templates.** Each stack doc's checks section links its
   `docs/stacks/examples/*.json` file(s) and states the file's assumptions
   (same table as A2-P0-7). Template files carry no comments (JSON), so the
   assumptions live in the docs next to the link.
4. **No automatic exposure, restated.** Docs keep the rule that nothing is
   active until named in `--tools`/`defaultTools`/SDK selection; the example
   launch lines list companion tool names explicitly.
5. **`companions/README.md`** (already written and shipped): what a companion is,
   the two supported load paths (`pi install ./companions/<name>`, or
   `pi -e <repo>/companions/<name>` — both loaded in place), the warning that a
   single companion directory must not be copied out of the tree (its relative
   `src/` imports break), and the statement that companions are never loaded by
   installing core. Any link from it into `docs/` uses an absolute URL, since it
   ships and `docs/` does not.
6. **Migration of the README's "Shared extensions" section** (`docs/stacks/
   README.md`): after P0, point the git table at `companions/git` and keep the
   "register your own" note (developers may still hand-roll). Replace the
   guide's restated schemas with links to `companions/` and this plan — the guide
   says *what and when*; the plan and the source are the single source of truth
   for schemas (they drifted once already: `switchToBranch` vs `switchTo`, and an
   `all`/`-A` mode this plan excludes).
7. **Links resolve:** all new doc links verified by extending the existing
   readme-links test pattern to `docs/stacks/*.md` (test listed in A6).

---

## (A6) Acceptance matrix

Every row is a named test to be added under `tests/` (unit or integration per
existing layout). "Argv" tests assert the exact spawned argv via the shared
arg-builder functions (unit) plus fixture repos (integration). All disposable
git fixtures live in temp dirs; bare remotes are throwaway `git init --bare`.

| Tool | Happy path | Failure | Scope / boundary | Fixed backend / no generic route |
|---|---|---|---|---|
| `git_create_branch` | create+switch, create-only, from startPoint | duplicate branch; hookless failure modes via GIT_FAILED | name charset (`-b`, `..`, `~`, whitespace, 256 chars), startPoint via `validateCommitRevision` | argv exactly `["switch","-c",name]` / `["branch",name]` variants |
| `git_add` | stages named pair incl. untracked; rename pair | ignored file; nonexistent path | `..`, absolute, symlink-escape, option-like segment, leading-`:` pathspec (`:(glob)`, `:!`) → `INVALID_ARGUMENT`, 101st path → `LIMIT_EXCEEDED` | argv exactly `["add","--",…paths]` with child env `GIT_LITERAL_PATHSPECS=1` (literal paths, no pathspec magic); no `-A`/`-u` expressible (schema has no field) |
| `git_commit` | one commit, message byte-equal, filesCommitted | failing `pre-commit` hook → `GIT_FAILED`; empty index pre-check | message ≤ 4000; no field can stage/amend/verify-off | argv exactly `["commit","-m",message]`; no-auto-stage test (unstaged edit excluded) |
| `git_push` | push to bare `origin`; second push | non-fast-forward → `GIT_FAILED`, remote unchanged; missing upstream; detached HEAD | unknown remote; no force possible — argv asserted `["push",remote,branch]`; remote tip unchanged after rejected push | no refspec/flag field exists in schema |
| `js_format_write` | exact pre/post byte diff; other files untouched | formatter exit ≠ 0 → `VALIDATION_FAILED`; timeout → `TIMEOUT` | `..`/symlink/absolute/`node_modules` rejection; 51 paths → `LIMIT_EXCEEDED` | configured backend → exact argv (`prettier --write --`); no backend/flag/config field in schema |
| companion config (`FD5`) | no file → defaults; `formatter: "biome"` → Biome argv; mid-session edit ignored | malformed JSON / unknown key / non-enum value → `PARSE_ERROR` at session start; foreign `ctx.cwd` → `INVALID_ARGUMENT` | config never yields a program/argv: every value maps through a fixed enum→builder table | `pi-nobash-companions.json` is the only file a companion reads; core `.pi/pi-nobash.json` parsing unchanged |
| `py_format_write` | exact pre/post diff | as above | as above | argv exactly `["format","--",…paths]` |
| templates | parse via `loadValidationConfig`; `run_validation` executes each check | malformed JSON → `PARSE_ERROR` | every check read-only — template scan test asserts no `--write`/`--fix`/`git add`/`install` in any `program`/`args` | `unit_file` uses verified `node_test` adapter only |
| `js_lint_fix` / `py_lint_fix` | exact pre/post diff on safe-fixable fixture | exit ≠ 0; timeout | scope as formatters | no `--unsafe-fixes`/`--unsafe` in any argv (assert); schema has no mode field |
| `js_dep_add`/`js_dep_remove` | `package.json`+lockfile diff exactly as npm produces; node_modules present | name-grammar rejections (`pkg@1.2.3`, `github:…`, `npm:…`, uppercase, empty) | 21 packages → `LIMIT_EXCEEDED` | argv asserted: `["install","--ignore-scripts",…names]` — `--ignore-scripts` present and unremovable |
| `expo_dep_add` | version pinned by expo SDK in `package.json` diff | name-grammar rejections | as above | argv asserted `["expo","install",…names]` (no npm fallback) |
| `py_dep_add`/`py_dep_remove` | `pyproject.toml`+`uv.lock` diff as uv produces | specifiers (`pkg>=2`, `pkg[extra]`, `git+…`) rejected | as above | argv asserted `["add",…]`/`["remove",…]` |

**Cross-cutting tests (all tools):**

- **`CAPABILITY_GAP` not shell fallback — three distinct cases per companion:**
  1. **Unexpressible operation** — a request the selected schema cannot express
     at all (stage-everything for `git_add`, force push, install
     `pkg@version`) MUST return `CAPABILITY_GAP` (FD4 / handoff D6) — never
     another code, never a shell or generic-runner fallback.
  2. **Malformed or out-of-scope input** to a supported operation returns the
     typed input/scope code: `INVALID_ARGUMENT`, `PATH_OUT_OF_SCOPE`, or
     `LIMIT_EXCEEDED`.
  3. **Execution failure of the frozen backend** returns `GIT_FAILED`,
     `VALIDATION_FAILED`, or `TIMEOUT`.
  Unsupported operations are always `CAPABILITY_GAP`, and no code path spawns
  anything but the frozen backend (asserted by counting spawned processes in
  the fixture harness).
- **Core exposes no companion (D3 — the named test):**
  `tests/integration/companions-not-in-core.test.ts` loads
  `extensions/pi-nobash.ts` (the real core entry) with the fake-`pi` harness
  and asserts the registered tool-name set is exactly the seven packaged tools
  — `git_create_branch`, `git_add`, `git_commit`, `git_push`,
  `js_format_write`, `py_format_write`, `js_lint_fix`, `py_lint_fix`,
  `js_dep_add`, `js_dep_remove`, `expo_dep_add`, `py_dep_add`,
  `py_dep_remove` are all absent. Paired test loads each `companions/*/index.ts`
  with a fresh fake `pi` and asserts its tools appear **only** then. Together:
  installing/loading core exposes no companion (FD1/FD2, A12).
- **No-shell agent workflow demonstration (E2E):** fixture repo driven through
  one full loop with only typed tools: `git_status` → `edit` (fixture write) →
  `js_format_write` → `git_diff` → `git_add` → `git_commit` → `git_push` (bare
  remote) → `run_validation` — asserting (a) no non-frozen process was spawned
  beyond the frozen backends, and (b) every out-of-scope probe in the loop
  returned a coded error, never execution.
- **Doc tests:** template JSONs parse; `docs/stacks/*.md` links resolve
  (extends `readme-links.test.ts`); stack docs carry the Status column.

---

## (A7) Open decisions

Genuine choices only; each has a recommended default. None adds policy
machinery.

- **A7-1 `git_create_branch` default `switchTo`.** Default: **true** (create
  and switch, matching the dominant branch-then-work flow and the plan's
  `switchTo?` field). Alternative: false (create only — safer for
  multi-branch tooling agents but forces a second operation for the common
  case). Revisit only if a fixture workflow shows agents creating stray
  branches.
- **A7-2 `git_push` upstream convenience — DECIDED: include.** `setUpstream`
  (boolean, default false) emits `git push --set-upstream <remote> <branch>`.
  Decided because the recorded workflow is create-branch → commit → push, and
  without it the first push of every new branch needs a shell. It is one boolean
  selecting one extra fixed argv shape; setting upstream writes local branch
  config, not remote state.
- **A7-3 `git_add` tracked-only mode — DECIDED: include.** `trackedOnly: true`
  → `git add -u` (FD4). Bounded: it can never introduce an untracked file, so it
  cannot include something the model did not enumerate. `-A`/all remains excluded.
- **A7-4 Python formatter backends beyond Ruff.** Default: **Ruff only**
  (`python.formatter`/`python.linter` enums admit `ruff`; docs/stacks/python.md
  names it). Adding Black = one enum member + one fixed argv builder; add only
  on demonstrated demand.
- **A7-5 Biome as default JS backend vs Prettier.** Default: **Prettier**
  (widest file-type coverage incl. `.md`/`.css`; Expo template already assumes
  it). Biome stays a config switch — `companions.javascript.formatter:
  "biome"` (FD5). Revisit if a fixture project is Biome-native.
- **A7-6 `js_dep_add` lifecycle-script escape hatch.** Default: **none**
  (`--ignore-scripts` always). If native-build packages become a real blocker
  in practice, the narrow remedy is a separate developer-invoked flow, not a
  schema flag.

---

## DoD for this plan (checked)

- [x] All three outputs exist: this plan; `docs/stacks/examples/*.json` (5
      templates, Biome-clean); ROADMAP P0/P1 rows updated.
- [x] Every P0/P1 item names goal + AC + lever (Goal reconciliation table).
- [x] Frozen decisions with rejected alternatives (FD1–FD6 + PD7).
- [x] A4 section named exactly `Deferred: A4 Go diagnostics reuse`; no Go
      integration built.
- [x] D3 preserved: named test `companions-not-in-core.test.ts`.
- [x] D6 preserved: PD6 restatement + per-tool "no generic route" column.
