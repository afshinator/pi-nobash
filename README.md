# pi-nobash

Opt-in Pi package for agents that should not have model-facing Bash or any other
general-purpose execution tool.

An agent does not need to be malicious to cause damage; it just needs to be confident and wrong. A classic failure mode occurs when an agent hallucinates a file path or variable during a cleanup routine, resulting in commands like rm -rf / or wiping an unintended directory because an environment variable evaluated to empty.

The shell is removed from
the agent's toolset and replaced with a small library of purpose-built tools whose
implementations define what can happen. The model chooses a specific operation and
supplies bounded typed parameters; trusted code decides how to perform it. A
replacement tool never accepts arbitrary commands, executables, argv, scripts, or
interpreter input.

- **Target runtime:** `@earendil-works/pi-coding-agent` 1.1.0
- **Package version:** 2.3.0
- **Runtime dependencies:** none (Pi supplies `@earendil-works/pi-coding-agent` and `typebox`)
- **No build step:** Pi loads the TypeScript extension through `jiti`

## Why

Coding agents run wild, eventually. They **inevitably** output destructive command patterns due to context drift or bad argument ordering. Intercepting shell execution before it hits the underlying OS process protects the developer's local environment and other things the agent has access to.

An agent that hallucinates a command, misreads a path, or picks a destructive flag
faces *unbounded consequences* when it holds a shell. `pi-nobash` removes the general
execution interface rather than trusting the model to avoid it, and supplies
deliberately narrow alternatives for recurring engineering work.

The guiding rule: **the model picks a permitted capability and supplies bounded
inputs; trusted code implements it. If a capability is missing, it stays missing
and is reported as `CAPABILITY_GAP` — never routed to a shell.**

## What you get

Native Pi tools that `pi-nobash` keeps (not shipped by this package, just not
replaced): `read`, `grep`, `find`, `ls`, and — for agents that should be able to
change files — `edit` and `write`.

Seven packaged replacement tools, all registered with `defaultActive: false` so
loading the package alone exposes nothing:

| Tool | Capability | Mutates |
|---|---|---|
| `json_query` | typed query of one JSON document | no |
| `query_jsonl` | streaming filter/group/aggregate over JSONL | no |
| `git_status` | normalized branch/HEAD/file status | no |
| `git_diff` | working / staged / commit diff | no |
| `git_log` | bounded history with fixed fields | no |
| `git_show` | single-commit metadata and diff | no |
| `run_validation` | developer-defined named check (test/lint/typecheck/build) | depends on the check |

Plus:

- an **unconditional backstop** that blocks any direct `bash` tool call while the
  extension is loaded, even if a configuration override re-exposes it;
- **`/nobash-status`**, a diagnostic command reporting the loaded package/version,
  effective active tools, presence of known general-execution tools, availability
  of the packaged tools, and any incomplete configuration.

## Install

```sh
pi install ./pi-nobash              # user-level
pi install --local ./pi-nobash      # project-level (.pi/settings.json)
pi -e ./pi-nobash --tools read,grep,find,ls,json_query   # one run, not persisted
```

The package manifest is small; the only thing Pi needs is:

```json
{ "pi": { "extensions": ["./extensions/pi-nobash.ts"] } }
```

Remove it with `pi remove ./pi-nobash`, or delete the entry from the applicable
settings file. Nothing else is registered and there is no protection state to undo.

## Choose tools per agent

Installing the package and selecting tools are separate actions. Use Pi's native
tool selection; `pi-nobash` does not add a profile or permission layer.

**CLI (`--tools` is a plain-name allowlist):**

```sh
# read-only reviewer
pi -e ./pi-nobash --tools read,grep,find,ls,json_query,query_jsonl

# engineering agent
pi -e ./pi-nobash --tools read,grep,find,ls,edit,write,json_query,query_jsonl,git_status,git_diff,git_log,git_show,run_validation
```

`--tools` replaces the defaults; `+name`/`-name` modify them instead. `--exclude-tools`
applies after selection, and `--no-tools` starts with everything disabled. A list that
removes Bash but leaves another generic runner active does **not** meet the no-execution
goal — verify with `/nobash-status`.

**Project settings (`.pi/settings.json`):**

```json
{
  "packages": ["./pi-nobash"],
  "defaultTools": ["read", "grep", "find", "ls", "json_query", "query_jsonl"]
}
```

**SDK / headless sessions:** each session gets its own allowlist.

```ts
const { session } = await createAgentSession({
  cwd,
  tools: ["read", "grep", "find", "ls", "json_query", "query_jsonl", "run_validation"],
  excludeTools: ["bash", "powershell", "codemode"],
  sessionManager: SessionManager.inMemory(cwd),
  resourceLoader,
});
```

A supervisor's toolset never governs separately created peer sessions; configure each one.

## Configure named validation

`run_validation` executes only checks a developer defined in `.pi/pi-nobash.json`
under the workspace. The model can name a check and, for file-mode checks, choose
from approved target files; it can never supply a program, argument, or script.

```json
{
  "validation": {
    "checks": {
      "unit": {
        "program": "npm",
        "args": ["test"],
        "cwd": ".",
        "timeoutMs": 120000,
        "targets": { "mode": "none" }
      },
      "typecheck": {
        "program": "npm",
        "args": ["run", "typecheck"],
        "cwd": ".",
        "timeoutMs": 120000,
        "targets": { "mode": "none" }
      },
      "node_test_file": {
        "program": "node",
        "args": ["--test"],
        "cwd": ".",
        "timeoutMs": 60000,
        "targets": {
          "mode": "file",
          "roots": ["tests", "src"],
          "extensions": [".test.ts"],
          "runner": "node_test"
        }
      }
    }
  }
}
```

Semantics that matter:

- **The file is read once, at session start, and never re-read.** Editing it mid-session
  has no effect; start a new session. This closes a composition route where a session
  holding `write`/`edit` could change a check's program and then run it. A `run_validation`
  call whose working directory differs from the session's bound directory is rejected with
  `INVALID_ARGUMENT`.
- **`targets.mode: "file"` requires a `runner` adapter.** Only `node_test` is verified
  today (`node --test -- <file>`); any other runner name is rejected before a process
  starts. Use `{"mode": "none"}` for full checks.
- **Missing config file = no checks** (an empty set); malformed JSON or shape is `PARSE_ERROR`.
- Targets must resolve inside `roots`, exist as regular files, match `extensions` when
  set, must not have a final path segment starting with `-`, and are capped at 50.

## Tool reference

All tools return Pi's `AgentToolResult`. Successes carry model-facing text plus
`structuredContent` matching the declared `outputSchema`. Expected failures return
`isError: true`, text prefixed with the code (`"<CODE>: <message>"`), and
`details = { code, capability?, message }`. Codes: `INVALID_ARGUMENT`, `PATH_OUT_OF_SCOPE`,
`NOT_FOUND`, `PARSE_ERROR`, `LIMIT_EXCEEDED`, `TIMEOUT`, `VALIDATION_FAILED`, `GIT_FAILED`,
`CAPABILITY_GAP`. Only unexpected `INTERNAL_ERROR` is thrown.

### `json_query`

```ts
{
  path: string,                 // JSON file, resolved against the session cwd
  root?: JsonPath,              // array of {key} | {index} segments
  where?: Predicate[],          // AND-combined
  select?: { as: string, path: JsonPath }[],
  aggregate?: { as: string, fn: "count"|"sum"|"min"|"max"|"avg", path?: JsonPath }[],
  orderBy?: { field: string, direction: "asc"|"desc" }[],
  limit?: number                // 1..500
}
```

Predicates: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `exists`, `is_null`, `in`,
`contains_string`. Output: `{ matched, returned, truncated, results }`. Numeric
operators and `sum`/`min`/`max`/`avg` accept only JSON numbers — no string coercion.
Ordering applies to projected scalar aliases, not raw paths.

### `query_jsonl`

Streams a JSONL file line by line.

```ts
{
  path: string,
  malformedLine: "error" | "skip",
  where?: Predicate[],
  select?: { as, path }[],
  groupBy?: { as, path }[],
  aggregate?: { as, fn, path? }[],
  orderBy?: { field, direction }[],
  limit?: number
}
```

Output: `{ scannedLines, parsedLines, skippedMalformedLines, matchedLines, returnedRows, truncated, results }`.
Streaming caps: 2 MiB per line, 10,000 distinct groups, 500 buffered rows for sorting —
each exceeded cap is `LIMIT_EXCEEDED`, not a silent partial result.

### Git (read-only)

```ts
git_status: { paths?: string[], includeUntracked?: boolean }
git_diff:   { mode: "working"|"staged"|"commit", revision?: string, paths?: string[], contextLines?: 0..100 }
git_log:    { maxEntries?: 1..200, paths?: string[] }
git_show:   { revision: string, paths?: string[] }
```

`revision` is accepted only for `git_diff mode:"commit"` and `git_show`. Revisions are
validated against a conservative charset and then verified with
`git rev-parse --verify --quiet <rev>^{commit}` before use. Git is invoked directly with
fixed argv — no shell, no free-form flags, no model-supplied command line. Outputs are
bounded (100 KB per stream; `git_status` fails visibly rather than returning a truncated list).

### `run_validation`

```ts
{ check: string, targets?: string[] }
```

Output: `{ check, targets, exitCode, timedOut, stdout, stderr, truncated, durationMs }`.
A nonzero exit is `VALIDATION_FAILED`, not an internal error. Every check has a
developer-set timeout; cancellation aborts the child process.

### Bounds

Model-facing limits are fixed constants, not model-chosen: 64 KiB per result text,
500 structured rows (100 default), 32 MiB JSON input, 2 MiB JSONL line, 100 KB per
Git stream, 200 Git log entries (50 default), 100 context lines, 50 paths per Git
request, 50 validation targets.

## Diagnostics

```
/nobash-status
```

Reports the five required items: loaded package and version; effective active tools
(or an explicit unavailable state); presence/absence of known general-execution tools
(`bash`, `powershell`, `codemode`); availability and active/inactive state of each
packaged tool; and any incomplete configuration or `none known`. If a known runner is
active it prints `conformance: NONCONFORMING`. This is a configuration diagnostic, not
a security attestation.

## Customize and extend

- **Per-agent tool subsets.** Different Pi invocations, `.pi/settings.json`, or SDK
  `tools` arrays give different agents different capabilities.
- **Validation checks** are entirely developer-defined in `.pi/pi-nobash.json`.
- **Domain tools belong in separate extensions.** `fallow`, `herdr`, finance,
  deployment, diagram rendering, and similar capabilities are intentionally not part
  of this package; add your own Pi extension for them.
- **The Bash backstop is fixed.** It does not parse command text and does not try to
  judge whether a command is safe; it blocks the `bash` tool outright.
- **Nothing is sandboxed.** `edit`/`write`, Git inspection, and repository-controlled
  validation can all have real effects. `pi-nobash` narrows the model's reach; it does
  not make permitted operations harmless.

## Architecture

```
Pi session
├── native selected tools        read / grep / find / ls / edit / write
└── pi-nobash extension          extensions/pi-nobash.ts
    ├── bash blocker             src/pi-guard.ts      (unconditional tool_call block)
    ├── /nobash-status           src/status.ts        (pure report builder + command)
    ├── json tools               src/json/            (operators, streaming, schemas)
    ├── git tools                src/git/             (rev validation, bounded exec)
    └── validation               src/validation/      (config, target, adapter, runner)
        shared: src/constants.ts, src/errors.ts, src/path-policy.ts
```

Layer rules: Pi's native tool selection is authoritative; packaged tools are inactive
until named; read-only and mutating capabilities are separate; trusted code owns
mechanics (parsers, fixed executables, argv); unsupported work returns
`CAPABILITY_GAP` rather than falling back to execution.

## Implementation decisions and tradeoffs

These decisions are not in the original product/technical spec; each is recorded in
full, with rejected alternatives, in `docs/pi-nobash-technical-spec-amendments.md`
(repo only, not shipped).

| # | Decision | Tradeoff accepted |
|---|---|---|
| A1 | No build step; Pi's `jiti` loads the `.ts` source directly; tests use Node's built-in `node:test`; imports use explicit `.ts` specifiers. | No compiled artifact and no framework conveniences; `tsc --noEmit` is the type gate. |
| A2 | Host packages (`pi-coding-agent`, `typebox`) are `peerDependencies: "*"`, not exact pins. | Follows Pi's package rule and avoids duplicate host modules; local dev pins exact versions in `devDependencies`. |
| A3 | Biome and Fallow are development-only; a `files` allowlist ships only `extensions/`, `src/`, `README.md`. | npm consumers never receive dev tooling, tests, specs, or `.mypi/` run state. |
| A4 | JSON operators are typed object shapes with a fixed verb list (no expression/query mini-language). | Irregular transformations are `CAPABILITY_GAP`, by design. |
| A5 | Expected errors are returned as `isError: true` envelopes with `"<CODE>: <message>"` text; only internal faults throw. | Callers must read `details.code`; the model gets a consistent visible failure. |
| A6 | Git revisions are shape-checked and then `rev-parse --verify`-confirmed; option-like paths are rejected; no `--` passthrough. | Some legitimate exotic revspecs are refused in exchange for no argv injection. |
| A7 | Targeted validation uses a named runner adapter; only `node_test` is verified, everything else must use `targets.mode: "none"`. | Targeted runs are unavailable for other runners until an adapter is verified and tested. |
| A8 | Pi extension APIs (`registerCommand`, `registerTool`, `tool_call` blocking) are treated as test-verified, not assumed from docs. | Requires runtime tests against the pinned Pi version. |
| A9 | Implementation, not the spec, freezes under-specified shared contracts before work starts. | Slower dispatch; fewer divergent interfaces between parallel authors. |
| A10 | `.pi/pi-nobash.json` is read once at session start and never re-read; a foreign cwd is rejected; snapshots are keyed per session. | Config edits require a new session; in exchange, a writable workspace cannot swap a check's execution between write and use. |
| A11 | Every packaged tool sets a one-line `promptSnippet` (so it appears in the default system prompt's Available tools section), accurate `annotations` (`readOnlyHint: true` on the six read-only tools, none on `run_validation`), and imports only host packages declared in the manifest. | One more metadata rule per tool, test-enforced (`tests/unit/registration.test.ts`); discovery and permission hints stay honest at the cost of keeping three tests green. |
| A12 | Every packaged tool is registered with `defaultActive: false`: installing exposes no new model-facing tool until the developer names it in `defaultTools`. | Diverges from ecosystem packages (e.g. `pi-safe-shell`, which activates on install), so nothing changes for a model at install time; required by product goal G3 (per-agent tool selection). |
| A13 | No `main`, `license`, or `repository` field in `package.json`. | Pi loads the extension via the `pi.extensions` manifest, not a library entrypoint (`main` would point at code that is never imported); no `LICENSE` file exists, so no license identifier can be declared truthfully; the repository is reachable where the package is hosted and no Pi or npm tooling needs the field. |
| A14 | The entry path stays `pi.extensions: ["./extensions/pi-nobash.ts"]` instead of the ecosystem-common `./index.ts`. | Renaming is cosmetic churn; the manifest makes the path explicit and `extensions/pi-nobash.ts` is committed and loaded by the integration tests. |

Additional contracts from the first implementation run:

- **Bootstrap interface:** `extensions/pi-nobash.ts` default-exports one factory that
  calls `registerBashBlocker`, `registerStatusCommand`, `registerJsonTools`,
  `registerGitTools`, `registerValidationTools`.
- **Naming and exposure:** every packaged tool is `exposure: "direct"`,
  `defaultActive: false`, snake_case, declares a TypeBox schema, and has no
  `command`/`argv`/`script` parameter (asserted by a schema-audit test).
- **No execution by composition:** there is no generic runner, `restricted_exec`,
  codemode path, or model-selectable executable anywhere in the model-facing surface.

## Limits and non-goals

- Not a sandbox, container, or host-security product; no isolation guarantee.
- No adversarial-jailbreak, prompt-injection, or containment claims.
- No general command/code execution fallback, and no interpreter or arbitrary query language.
- No universal control over third-party extensions; an agent given another generic
  runner is outside the intended configuration even if this package is loaded.
- `powershell` and `codemode` are excluded by tool selection and reported by
  diagnostics; unlike `bash`, they are **not** hard-blocked by this package.
- Optional Git mutations (`git_create_branch`, `git_add`, `git_commit`), typed file
  mutations, and format conversions are deliberately deferred and not implemented.
- The historical workload inventory's 411-vs-414 call-count discrepancy is
  unreconciled; no coverage percentage is claimed.

## Known issues

N1-N5 from the run-2 review are **resolved in run 3**:

- **N1** the paired-performance test writes its fresh measurement to a temp dir and
  asserts the shape still matches the frozen, tracked `paired-results.json`, which
  `npm test` no longer rewrites.
- **N2** the live provider call in `tests/integration/cli-process.test.ts` is opt-in
  via `PI_NOBASH_LIVE_PROVIDER=1`; the default suite is offline and credential-free.
- **N3** the validation snapshot `Map` releases a session's entry on Pi's verified
  `session_shutdown` hook.
- **N4** the CLI test's `auth.json` temp copy is scoped to the spawn and removed by
  an `after()` hook plus exit, signal (SIGINT/SIGTERM), uncaught-exception, and
  unhandled-rejection handlers; a SIGKILL or power loss is uncatchable and cannot be
  handled by any process.
- **N5** the git path cap is `MAX_GIT_PATHS` (100, spec 9.6) everywhere; the local
  50 is gone, asserted by a schema test.
- `npm run fallow` exits non-zero with refactor targets (no correctness defects);
  they are explicitly deferred.

## Development

```sh
npm install
npm test            # node --test            (97 tests; 1 opt-in live-provider case skipped)
npm run typecheck   # tsc --noEmit
npm run lint        # biome check .
npm run fallow      # fallow health
```

No build step. Runtime source lives in `extensions/` and `src/`; tests in `tests/`
(unit, integration, coverage, performance). Local `pi` model calls in tests use the
`deepseek` provider and are **opt-in**: set `PI_NOBASH_LIVE_PROVIDER=1`. Without it
the default suite performs no provider call and needs no credentials.
