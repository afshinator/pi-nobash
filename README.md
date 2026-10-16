# pi-nobash

![pi-nobash: the shell is removed and replaced by a small set of purpose-built tools](assets/pi-nobash-hero.webp)

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
- **Package version:** 2.4.0
- **Runtime dependencies:** none (Pi supplies `@earendil-works/pi-coding-agent` and `typebox`)
- **No build step:** Pi loads the TypeScript extension through `jiti`

## Why

Coding agents run wild, eventually. They **inevitably** output destructive command patterns due to context drift or bad argument ordering. Intercepting shell execution before it hits the underlying OS process protects the developer's local environment and other things the agent has access to.

An agent that hallucinates a command, misreads a path, or picks a destructive flag
faces *unbounded consequences* when it holds a shell. `pi-nobash` removes the general
execution interface rather than trusting the model to avoid it, and supplies
deliberately narrow alternatives for recurring engineering work.

The danger compounds at scale. An automated software factory or an agent swarm runs many
agents concurrently, for long stretches, usually with nobody watching each tool call. A
single hallucinated path or destructive flag is no longer one mistake — it is that same
mistake multiplied across every agent and every iteration, firing without a human in the
loop. Narrowing each agent to a small, enumerated toolset bounds the blast radius per
agent instead of relying on every model in the fleet to be careful.

The same shape fits domain-specific agents that should never hold a shell at all — workers
with one job and a known toolset. A billing-reconciliation agent might need only `read`,
`grep`, and `json_query`; a docs agent `read`, `grep`, `find`, `edit`; a log-triage agent
`read`, `grep`, `query_jsonl`. For these, `bash` has no upside: the agent never needs it,
so every command-shaped failure mode is pure downside. Give it the exact set it uses and
nothing else.

The guiding rule: **the model picks a permitted capability and supplies bounded
inputs; trusted code implements it. If a capability is missing, it stays missing
and is reported as `CAPABILITY_GAP` — never routed to a shell.**

What it looks like when an agent reaches for the shell:

![pi-nobash demo: a direct bash call is blocked while a typed query_jsonl call passes](assets/pi-nobash-demo.gif)

*Real extension and real `tool_call` pipeline with a canned model — deterministic and
offline. Regenerate with `vhs scripts/demo-intercept.tape`.*

The blocker is unconditional: it never reads the command text, so a plausible-looking
command is refused exactly like a destructive one.

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

## Three ways to change what an agent can do

1. **Select tools** — Pi's `--tools`, `defaultTools`, or SDK `tools`. Chosen from tools that
   already exist: this grants or withholds capability but creates nothing.
2. **Configure `run_validation`** — `.pi/pi-nobash.json` maps a check name to a fixed,
   developer-owned command. It is a **check**: tests, lint, typecheck, build, a schema
   validator — a diagnostic the model may only *name*. Never hide a mutation here (a `git
   add`, a delete, a formatter's write mode). A check that mutates misuses a diagnostic tool
   and still cannot work, because the model has no way to pass a branch name, file list, or
   commit message.
3. **Write a Pi extension** — one typed tool per operation, for anything not already covered,
   and specifically for anything that needs model-supplied parameters or that changes files
   or history.

Decision rule: **already a tool → select it. A fixed, read-only check → config. Anything
with model-supplied parameters, or anything that mutates → extension.**

Git as an example: read-only inspection needs nothing — `git_status`, `git_diff`, `git_log`,
and `git_show` ship and are selectable today. Branch, stage, and commit are not shipped and
cannot be configured, so they need a small extension registering `git_create_branch`,
`git_add`, and `git_commit`.

## Documentation

Longer guides live in the repository; the links below open on GitHub and work from the npm
package page too.

- [Replacing Bash](https://github.com/afshinator/pi-nobash/blob/main/docs/replacing-bash.md) — what agents reach for the shell to do, what pi-nobash already covers, and the exact fix for each gap (config vs a small extension).
- [Stack setups](https://github.com/afshinator/pi-nobash/blob/main/docs/stacks/README.md) — complete tool-list + checks + extension combinations for TypeScript (Node and React Native/Expo), Python, and Rust/Go.
- [Named validation](https://github.com/afshinator/pi-nobash/blob/main/docs/validation.md) — the `.pi/pi-nobash.json` reference and its session-start semantics.
- [Tool reference](https://github.com/afshinator/pi-nobash/blob/main/docs/tool-reference.md) — parameters, outputs, bounds, and the error envelope for all seven tools.
- [Design decisions and tradeoffs](https://github.com/afshinator/pi-nobash/blob/main/docs/design-decisions.md) — architecture, the A1–A14 decisions, and the non-goals.
- [Issues](https://github.com/afshinator/pi-nobash/issues) — the live work queue.

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

> **`bash` is not the only shell.** `pi-nobash` hard-blocks `bash` at the `tool_call`
> level; `powershell` and `codemode` are excluded only by your tool selection and are
> **not** blocked by this package. Drop them from the allowlist or add
> `--exclude-tools powershell,codemode`, then confirm with `/nobash-status`, which
> reports each known runner as `present` or `absent`.

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

Working combinations of the tool list, checks, and extensions for TypeScript (Node and
React Native/Expo), Python, and Rust/Go: [Stack setups](https://github.com/afshinator/pi-nobash/blob/main/docs/stacks/README.md).

## When a capability is missing

A no-execution agent does not improvise a fallback. When the model asks for something the
selected tools cannot express, the run stops at a visible `CAPABILITY_GAP` — a structured
error result, or a `CAPABILITY_GAP:` statement when no tool exists at all — rather than
inventing a command.

Coverage is explicit and finite — [Three ways to change what an agent can do](#three-ways-to-change-what-an-agent-can-do) is the mechanism for closing a gap.

[Replacing Bash](https://github.com/afshinator/pi-nobash/blob/main/docs/replacing-bash.md) maps the observed shell uses to pi-nobash
coverage and gives the exact fix for each gap.

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

