# pi-nobash — Technical Implementation Specification v1.2

**Status:** Implementation baseline. Mechanisms are source-confirmed at the pinned commit; guarantees become operational only when their runtime tests pass.
**Date:** 2026-10-08
**Product:** `pi-nobash`
**Target source baseline:** `earendil-works/pi` commit `6fb2e78`, `@earendil-works/pi-coding-agent@1.1.0`
**Companion:** pi-nobash — Product Specification v1.3 (requirements, AC1–AC16, Q1–Q10).
**Purpose:** Specify the package, enforcement mechanisms, semantic tools, execution boundaries, verification, and phased implementation needed to replace model-facing bash without losing routine engineering functionality.

> **Governing rule (applies to every claim below): SOURCE-CONFIRMED is not RUNTIME-VERIFIED.** Reading the pinned source establishes an *intended mechanism*. A guarantee may be claimed operational only after its runtime test (Section 9) passes. No test is marked passed because a source reference exists.

## 1. Scope, authority, and evidence

This is a **standalone build specification**. The package is opt-in. It removes `bash` from normal model-facing tools using Pi settings, blocks prohibited tool calls using an extension, and supplies typed, efficient alternatives. It does not remove all process execution. Controlled Git, builds, tests, linters, and project utilities remain necessary.

### 1.1 Provenance key (R4) — three evidence statuses

Every material Pi-behavior claim carries exactly one **evidence** status:

- **SOURCE-CONFIRMED:** Specific code or documentation was inspected at commit `6fb2e78` (`@earendil-works/pi-coding-agent@1.1.0`), with a traceable file and symbol, in this project's clone during the investigation that produced this document. This establishes *source behavior only*, not operational coverage. The findings were reported from that clone inspection; **V0 (Section 9.1) must reproduce** each trace independently and record a source-evidence log. Source locations are identified by file and symbol; **line numbers are advisory and may drift.**
- **RUNTIME-VERIFIED:** A real executable Pi test passed for an identified version, platform, invocation mode, configuration, and test artifact. Only the precise property exercised may be claimed. Nothing carries this status at v1.2.
- **UNVERIFIED:** Proposed, inferred, untested, or not independently traced. An unverified behavior never acquires a passing diagnostic state by assertion; unknown required preconditions fail closed.

**SPECIFIED is a requirement classification, not an evidence status.** A design decision may be SPECIFIED (normative, implementers must satisfy it) without any claim that its implementation has been verified. A proposed interface is tagged UNVERIFIED on its *Pi-behavior* dependencies until V0 proves feasibility. A behavior can be both SOURCE-CONFIRMED and RUNTIME-VERIFIED, with separate evidence records.

**Source-provenance note (P1):** The source files cited throughout were inspected at the pin in this session's clone (`types.ts`, `agent-session.ts`, `loader.ts`, the RPC/print drivers, and the sandbox/gondolin examples). This document does not claim those results were executable-test verified. V0 reproduces the inspection. The earlier draft's "pinned GitHub pages unavailable" wording does not describe this investigation and is not reused.

### 1.1.1 Source-trace register (pin `6fb2e78`; SOURCE-CONFIRMED per reported inspection; V0 reproduction outstanding)

| Ref | Source location / symbol | Finding | Verification follow-up |
|---|---|---|---|
| SF1 | `src/core/extensions/types.ts`, `BeforeAgentStartEventResult` | Fields `message?`, `systemPrompt?`; **no cancellation field**. `systemPromptOptions` is event input, not a result field. | V0 source trace |
| SF2 | `types.ts`, `InputEventResult`; `agent-session.ts`, `_runInputHandlers` | `{action:"handled"}` short-circuits eligible input before agent dispatch (handler returns `undefined`). | A1 across entry paths |
| SF3 | `agent-session.ts` `prompt`/`steer`/`followUp`; `modes/rpc/rpc-mode.ts`; `modes/print-mode.ts`; `docs/sdk.md` | Documented normal entry points route through session input handling. Print steer/followUp *availability* not established. | V0 applicability + A1 |
| SF4 | `types.ts`, `ToolCallEventResult`; `docs/extensions.md` | `{block?, reason?, terminate?}`; per-call `block` is load-bearing. `terminate` ends a batch only when every finalized result in it sets it. A `tool_call` handler failure blocks the tool (fail-safe). | A2 batch/failure tests |
| SF5 | `docs/extensions.md` `ctx.shutdown`; `agent-session.ts` abort paths | Shutdown is secondary (interactive idle-deferred; print no-op). `ctx.abort()`/`agent.abort()` is the forward-only in-flight cancel candidate. | A3 |
| SF6 | `types.ts`, `before_provider_request` result type `unknown` | No typed pre-request block/reject contract at pin. | V0 source trace; A3 |
| SF7 | `core/extensions/loader.ts`, `loadExtension`/`loadExtensionsInternal` | A failed/throwing extension factory is caught and collected; startup proceeds. An absent/unloaded extension cannot fail closed. | V0 source trace + missing-component negative test |
| SF8 | `types.ts`, `ExtensionToolContext.executeTool()` | Runs a tool "through the same validation, hooks, and permission checks as model-issued calls" — the candidate **real-dispatch canary primitive**. No general hook-introspection API found. Pre-turn timing and canary side-effects unresolved. | V0-HOOK |
| SF9 | `examples/extensions/sandbox/index.ts` (`wrapWithSandbox`+`spawn`); `gondolin/index.ts`; `packages/env` (`ExecutionEnv` not on `ExtensionAPI`) | Tool-wrapped/sandboxed execution does not automatically cover arbitrary extension-internal Node execution. | A5 + R2b adversarial suite |
| SF10 | `agent-session.ts` construction + `bindExtensions` `session_start` emission | Effective `defaultTools` resolves at session **construction, before `session_start`** (corrects the earlier reversed order). Full per-mode ordering not established. | V0 source trace per mode + runtime sequencing test |

### 1.2 Product goals

1. Remove unrestricted model-facing `bash` as the default operation interface.
2. Preserve read/search/edit, structured-data inspection, Git, and validation tasks using safe purpose-built capabilities.
3. Enforce separate authorization, operation-policy, and OS-isolation boundaries.
4. Prefer lower end-to-end latency, fewer model turns, bounded output, and repeatable correctness over superficial subprocess microbenchmarks.
5. Support solo and project/team adoption with reliable diagnostics and reversible deactivation.

### 1.3 Non-goals and scope limits

- No universal security claim for unloaded extensions, arbitrary untrusted SDK embedders, or host process execution outside an isolation boundary.
- No attempt to blacklist all dangerous shell strings or to expose unrestricted Python/Node/jq/SQL through renamed tools.
- No mandatory launcher for v1. A host/launcher check for *missing enforcement component* is a future option (Q10).
- No automatic policy hot-reload. A fresh Pi process is the supported transition for configuration/activation changes.
- No guarantee that cancelling a provider stream recalls data already transmitted.
- No universal performance improvement without task-level measurements.
- No bundled project-specific utilities such as `herdr` or `fallow`; those belong in optional companion packages.

## 2. Terminology and invariant boundaries

**Protected session:** A Pi session configured to use, or currently using, the `pi-nobash` profile. **Protected turn:** A turn within such a session, including when protection was intended but initialization failed. A missing `-bash` setting does not quietly change a protected turn into an unprotected one.

**Gate:** Runtime state checking required protection preconditions. **Green:** all *required and verified* startup conditions pass. **Red:** any required condition fails or cannot be established. **Unknown:** a condition cannot be tested; for required startup conditions, unknown must act as red.

**Model-facing exposure:** tools returned by the effective Pi tool-selection state, observed by `pi.getActiveTools()`. This answers *what is presented*, not *what can execute*.

**Tool enforcement:** interception of Pi tool calls. **Execution containment:** an OS/container/VM boundary covering the relevant processes. A tool hook does not intercept a separate extension's direct `child_process.execFile()` call.

### 2.1 Three R2a guarantees (different strength)

| ID | Claim | Primary candidate | Evidence / release status |
|---|---|---|---|
| **G1** | Under a red gate, no unauthorized **Pi-intercepted tool call** executes | `tool_call` returning `block:true`, optionally `terminate:true` | Mechanism SOURCE-CONFIRMED; claim requires A2 (tool/batch/continuation) |
| **G2** | Under a red gate, new agent turns are refused through **supported session entry points** | `input` returning `{action:"handled"}` | Mechanism SOURCE-CONFIRMED; claim requires A1 (mode × entry-path) |
| **G3** | An existing model/provider operation is cancelled after a gate becomes red | `ctx.abort()` candidate | Conditional; requires A3 runtime tests + outcome reporting; cannot undo transmission |

**G1 scope (binding, R3).** "Tool execution" in G1 means **Pi-intercepted tool calls only**. G1 does **not** cover execution that never becomes a Pi tool call — extension-internal `child_process`, a separate extension's Node code, or interpreter composition inside an allowed tool. That execution is bounded only by whole-process isolation (R2b / S10b / Section 7 / A5). Wherever G1 appears in this document, this scope applies; the containment boundary is never obscured by G1's shorthand.

**Claim policy:** G1 and G2 may be advertised only after their coverage tests pass on the supported runtime. G3 is **not** included in the v1 comprehensive-cancellation claim unless A3 demonstrates it. G3 must not block release of correctly scoped G1/G2, but its failure must be observable and protection must not be misrepresented.

### 2.2 R2a versus R2b

- **R2a, presence/admission:** loaded enforcement component, supported Pi, active settings, effective tool exposure, pre-turn refusal, tool-call blocking, and diagnostic reporting. A failing gate prevents supported fresh turns and Pi-intercepted tool-mediated work.
- **R2b, runtime coverage:** compositions and alternative execution paths, path/argument checks, cross-package tool calls, validation scripts, symlinks, secrets, and OS isolation. Verified by an adversarial suite, not startup self-reporting. R2a and R2b fail independently; a green R2a implies nothing about R2b.

## 3. Distribution and lifecycle

### 3.1 Deliverable layout (SPECIFIED, organizational)

```text
pi-nobash/
  package.json
  extensions/
    pi-nobash.ts                 # registration, gate, hooks, status command
    policy/                      # access control, path/argv validators, modes
    tools/                       # query_jsonl, json_query, git, validation, etc.
    runtime/                     # constrained executor, diagnostics, telemetry
  skills/
    no-bash-operations/SKILL.md  # concise task-to-capability guidance
  tests/
    unit/
    integration/
    adversarial/
    benchmarks/
  examples/
    project-settings.json
    user-settings.json
```

The layout is organizational, not a guarantee that a Pi package automatically installs `defaultTools` settings.

### 3.2 Package manifest and settings are separate

**Package manifest** (SPECIFIED; validate the exact package schema at the pin):

```json
{
  "name": "pi-nobash",
  "version": "1.0.0",
  "keywords": ["pi-package"],
  "pi": { "extensions": ["./extensions"], "skills": ["./skills"] },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*"
  }
}
```

**Important:** planning example, **not an approved final manifest**. Verify which `@earendil-works/*` packages are actually imported and the host's package-manager expectations; declare only necessary peer dependencies, do not bundle Pi-host packages, and implement explicit runtime compatibility checks. The known historical reason for checking at least 0.84.2 is a fix where `defaultTools` could drop extension/SDK custom tools when selecting built-in defaults (SOURCE-CONFIRMED rationale). The implementation target is **1.1.0 / `6fb2e78`**, not an untested assertion of compatibility with every later version.

**Project settings** (SPECIFIED; validate against the pin):

```json
{
  "packages": ["git:github.com/<owner>/pi-nobash@<pinned-ref>"],
  "defaultTools": ["-bash", "+grep", "+find", "+ls", "+codemode"]
}
```

- Package resources register replacement tools, hooks, and skills.
- `defaultTools` in **Pi settings** removes built-in bash; it is not embedded in the package manifest.
- The extension's `tool_call` hook blocks execution as an independent backstop.
- A CLI or SDK tool-selection override may re-expose bash: the gate must detect exposure and remain red; the hook still blocks calls when loaded.
- Project trust and first-launch package installation behavior must be validated in integration tests, including noninteractive processes.

### 3.3 Activation scenarios

| Scenario | Required steps | Expected result |
|---|---|---|
| Solo | Install pinned package into user scope, configure user `defaultTools`, restart | Gate runs before supported agent turns; no model-facing bash |
| Team | Commit one `.pi/settings.json` with both `packages` and `defaultTools`; contributor opens and trusts project | Automatic package/settings loading on supported Pi; no per-person manual configuration after trust |
| Headless/SDK | Supply effective package/resources/tool settings and trust explicitly per independent process | Every claimed-protected instance independently passes gate |
| Partial state | Package loaded but `-bash` absent, or package removed but `-bash` remains | First reported red/partial by loaded package; second cannot be detected by an unloaded package |
| Deactivation | Remove both package and `-bash` settings, restart | Normal Pi selection returns, subject to other settings |

**Missing-component limitation:** An unloaded extension cannot refuse a session (SOURCE-CONFIRMED: a failed/absent factory is caught and startup continues; `packages/coding-agent/src/core/extensions/loader.ts`, `loadExtension` / `loadExtensionsInternal`). No v1 claim covers a project with a stale `-bash` setting but no functioning `pi-nobash` code. A trusted launcher or host-level check would be required for that stronger claim (Q10).

### 3.4 Mid-session changes

- Treat the last gate-evaluated effective state as the current documented status, with a timestamp.
- Activating/deactivating/updating security settings requires restart for supported behavior.
- When any required policy condition is **known** to have weakened, turn red immediately and reject subsequent intercepted turns and tools.
- Detecting arbitrary external file/package changes is not guaranteed; document observed vs unknown state (Q8).
- If the runtime supports a reliable tool-change event, it may invalidate the gate; do not assume hot-reload fully revokes old tools.

## 4. Extension startup and red-gate control

### 4.1 Startup order — one source-confirmed relationship, one proposed model

**SOURCE-CONFIRMED (SF10), the only ordering relationship asserted as fact:** effective `defaultTools` selection (including `-bash`) resolves at `AgentSession` **construction**, **before `session_start`** is emitted inside `bindExtensions()`. An earlier draft placed `session_start` before `defaultTools` resolution; that is incorrect and must not be carried forward.

**Proposed integration model (UNVERIFIED; for implementation planning and V0 tracing, not asserted as a total order):** the diagram below is a working hypothesis of the full lifecycle. Its only SOURCE-CONFIRMED element is the `defaultTools`-before-`session_start` relationship above. The relative order of project-trust processing, extension-factory completion, handler registration, construction-time tool selection, and `session_start` across every mode is **UNVERIFIED** and is a V0 source-trace task (Q4/Q14). Treat it as the sequence V0 confirms or refutes, not as established.

```text
# PROPOSED integration model — UNVERIFIED except SF10 (defaultTools before session_start)
project trust resolves          # project settings/packages read only after trust
  -> extension module loads; factory runs
       register red-by-default shared gate state
       register input handler, tool_call blocker, diagnostic command
       register typed tools (inactive unless direct/model-only)
  -> AgentSession constructed: active tool set resolved from defaultTools   # SF10
       (-bash removes built-in bash; +name adds; registered replacements coexist)
  -> bindExtensions() emits session_start                                   # SF10: after the above
  -> resources_discover
  -> first turn: input -> before_agent_start -> model -> tool events
```

**Mandatory V0 result:** produce actual per-mode traces (interactive, print, RPC, SDK) identifying package trust/load, construction-time tool selection, handler registration, `session_start`, and earliest input. No diagram or guessed chronology substitutes for a trace. Startup timing bears directly on fail-closed enforcement, so the proposed model may not be relied upon until traced.

**Required property (SPECIFIED):** No interval during which protection is claimed but hooks are absent and agent work is admitted. Verify hook-registration ordering in the pinned extension loader, not merely source order. If hooks cannot be active before the first turn, the deployment design must change before claiming G2.

### 4.2 Source-level hook contracts (SOURCE-CONFIRMED at pin; symbols authoritative, lines advisory)

- `input` handler returning `{ action: "handled" }` short-circuits eligible input before the agent run (`agent-session.ts`, `_runInputHandlers`; early return where `inputResult.action === "handled"` yields `undefined`).
- `tool_call` can return `{ block: true, reason?, terminate? }`. `terminate` requests stopping after the current tool batch **only when every finalized result in that batch sets it**; per-call `block` is the actual safety condition (`extensions/types.ts`, `ToolCallEventResult`). Validate the exact return schema in V0 before writing code.
- `ctx.abort()` aborts the active agent operation via its cancellation path; it does not undo network transmission. `ctx.shutdown()` is secondary, deferred until idle in interactive mode and a no-op in print mode (`docs/extensions.md`). Neither substitutes for the guards.
- `BeforeAgentStartEventResult` is `{ message?, systemPrompt? }` at `6fb2e78` (`extensions/types.ts`); `systemPromptOptions` is an **event** property, not a result field. There is no cancel result; **do not use `before_agent_start` as a guard.**
- `before_provider_request` result type is `unknown` with no documented reject/block contract at this pin (`extensions/types.ts`). Do not invent one.
- No public hook-introspection API exists on `ExtensionAPI` (SOURCE-CONFIRMED: no exposed `hasHandlers`/`listHandlers`/introspection method; `hasHandlers` is internal to the runner). Interception evidence therefore requires a canary (Section 9.1, V0-HOOK).
- `ctx.executeTool(name, args, options)` runs a tool "through the same validation, hooks, and permission checks as model-issued calls" (`extensions/types.ts`, `ExtensionToolContext.executeTool`). It is the canary primitive for real-dispatch attestation. It is exposed on the **tool-execution** context, not clearly in the factory/`session_start` — see V0-HOOK for the pre-turn-timing question.
- Observed public turn-start paths use `session.prompt()`, `session.steer()`, `session.followUp()` (RPC: `modes/rpc/rpc-mode.ts`; print: `modes/print-mode.ts`; SDK: `docs/sdk.md`), all routing through `_runInputHandlers`. Lower-level `session.agent.prompt()` / `agent.continue()` can bypass input processing.

These are implementation leads, not an assertion that an unexecuted prototype is safe.

### 4.3 Red-gate behavior (behavioral contract; no SDK pseudocode)

Normative behavior, not code. Exact return shapes are fixed in V0 before any example code is written.

- **When the gate is not GREEN:** the `input` handler must refuse supported new turns (short-circuit before the agent run) and emit a deterministic enforcement-failure result to the turn's invoker; the `tool_call` handler must block unauthorized **Pi-intercepted** execution and record an audit reason. Per-call blocking is the safety condition; batch `terminate` is best-effort only.
- **When the gate is GREEN:** handling must conform to the pinned API's permitted return contract, and authorized calls proceed through the normal validation path.
- **Guard robustness:** a `tool_call` handler that throws must result in the tool being blocked (SOURCE-CONFIRMED fail-safe, `docs/extensions.md`); implementation must not convert its own exception into an allow.
- **Independence:** every registered model tool must also enforce authorization in its own trusted execution path, not only in the global hook. Some entry paths can bypass `input`, and one handler can consume input before later handlers see it; verify handler interactions with other installed extensions.

### 4.4 Shutdown and cancellation

- Invoke `ctx.abort()` when an active operation must be cancelled after a detected gate failure, where supported in that context.
- `ctx.shutdown()` may be requested as **secondary cleanup**, never as the primary admission or tool guard.
- Preserve a red guard until the process actually exits; do not clear it merely because shutdown was requested.
- Report cancellation as `requested`, `observed-stopped`, `failed`, or `unknown`; do not claim remote/provider-side recall.

### 4.5 `/nobash-status` contract

Register a custom `/nobash-status` command. Minimum fields:

```json
{
  "profile": "pi-nobash",
  "scope": "project|user|unknown",
  "piVersion": "...",
  "compatibility": "pass|fail|unknown",
  "gate": { "state": "green|red|unknown", "lastEvaluated": "...", "reasons": [] },
  "activeTools": ["..."],
  "bashExposed": false,
  "hookRegistration": "verified|self-reported|unverified",
  "mode": "restricted|engineering|escape-hatch",
  "replacementCapabilities": ["..."],
  "isolation": { "mode": "...", "verified": false },
  "coverage": { "suiteRevision": "...", "lastResult": "pass|fail|not-run|unknown" },
  "cancellation": { "lastOutcome": "requested|observed-stopped|failed|unknown|n/a" }
}
```

Separate **presented tools**, **hook registration/effectiveness**, **sandbox status**, and **last adversarial-suite evidence**. `hookRegistration` is `verified` only when the dispatch-path canary (V0-HOOK) has blocked a probe this session; self-registration is `self-reported`, never `verified`. An unknown required condition must not display green. An unloaded package cannot provide this command.

## 5. Policy, modes, and operations

### 5.1 Profiles

| Profile | Capabilities | Process policy |
|---|---|---|
| Restricted | `read`, `grep`, `find`, `ls`, read-only structured query, bounded codemode if enabled | No general process runner; no mutation |
| Engineering (default) | Restricted + authorized `edit`, `write`, typed Git, named validation and sanctioned lifecycle | No raw bash; validation commands execute only in approved environment |
| Escape-hatch | Engineering + `restricted_exec` | Only user/admin-enabled config, fixed programs/argv, mandatory isolation and audit |

A model cannot elevate its own profile, modify policy, or approve an escape-hatch request. A natural-language request is **not** permission.

### 5.2 Authoritative authorization pipeline

```text
model request
  -> strict typed schema validation
  -> verified agent identity/profile and operation authorization
  -> normalized workspace/path scope, symlink and effect checks
  -> deterministic backend selection
  -> common constrained executor / filesystem service
  -> output/error cap + audit metadata
```

Rules: reject unknown request properties; path containment must not be a plain string-prefix check; resolve symlinks and race-sensitive paths safely; do not accept arbitrary executable names, shell strings, unbounded globbing, or runtime code snippets under ordinary semantic operations. Read, write, process and network are separate effect classes. A declared read-only operation cannot use an unexpectedly mutating backend.

### 5.3 Hook scope versus internal code

- Enforce **every model-accessible Pi tool call** across loaded packages via the supported Pi interception path; run adversarial tests for custom tools and nested calls.
- For nested registered tools, prefer Pi's policy-aware `ctx.executeTool(...)` where supported; do not directly invoke another registered tool's `.execute()` to bypass interception.
- Internal Node `fs`/`child_process` calls in the package require the same shared authorization/execution service because Pi hooks may never see them.
- A separate third-party extension's direct `execFile` or arbitrary Node code is **not** hook-controlled. Whole-process isolation is the applicable containment boundary; without it, this code lies outside the enforceable cross-package promise. (This is the G1-scope boundary of §2.1, restated.)

### 5.4 Common execution service

A trusted helper for process-oriented typed operations, with:

- fixed executable and validated `argv`; `shell:false`;
- operation-specific allowed flags and use of `--` where meaningful;
- explicit allowed `cwd` and verified workspace scope;
- minimal environment and restricted credentials/network;
- cancellation propagated by `AbortSignal`;
- timeout, bounded stdout/stderr, predictable exit/error classification;
- audit details including backend, time, bytes, and effect class;
- execution **inside** the approved sandbox/workspace.

A named test such as `run_validation("unit")` may invoke repository-owned scripts that execute arbitrary code. Whole-process or process-execution containment is still needed. A shell-free `spawn()` alone is not a security boundary.

## 6. Semantic tool contracts and performance dispatch

### 6.1 Keep optimized Pi primitives direct

Use Pi `read`, `grep`, `find`, `ls`, `edit`, `write` without forcing every call through a universal dispatcher. Use `grep` with `literal:true` for fixed text, regex only when required, `find` for discovery, bounded `read` after locating relevant ranges. Respect effective role permissions on these built-ins.

### 6.2 Typed operations (minimum v1 surface)

| Tool | Initial behavior | Guardrail |
|---|---|---|
| `query_jsonl` | typed filter/project/count/group/aggregate; one-pass streaming of line-delimited objects | allowed paths, bounded output and memory, explicit malformed-line semantics |
| `json_query` | select/filter/count over modest JSON; possible native backend | typed AST; no freeform JS/jq/SQL strings |
| `git` | status/diff/log/show, then explicitly authorized add/commit/branch operations | subcommand enum + constructed argv; validate pathspec and mutation scope |
| `run_validation` | `check` is an approved named profile | host/trusted configuration owns command; sandbox/cancellation/time/output limits |
| `check_model` | inspect approved model and optional bounded live probe | explicit provider/network permission and secrets handling |
| `file_lifecycle` | narrow copy/move/delete when required | workspace scope; destructive policy, no unchecked recursive deletion |
| `restricted_exec` | exceptional allowlisted process + typed args | disabled normally; config-gated, isolated, audited |

Optional rendering/conversion is a narrow later capability. User-specific `herdr` and `fallow` are companion packages (bound by §5.3 tool-call policy; internal execution bound by §7), not core dependencies.

### 6.3 Example schemas (conceptual, to be finalized against TypeBox/Zod conventions)

```ts
type QueryJsonl = {
  path: string;
  where?: Array<{ field: string; op: "eq"|"in"|"gte"|"lte"; value: unknown }>;
  select?: string[];
  groupBy?: string[];
  aggregate?: "count"|"sum"|"min"|"max";
  limit?: number;
  maxOutputBytes?: number;
};

type GitOperation = {
  operation: "status"|"diff"|"log"|"show"|"add"|"commit";
  paths?: string[];
  revision?: string;
  message?: string;
};

type RunValidation = { check: string; timeoutClass?: "short"|"normal" };
```

The implementation must define canonical handling for empty matches, errors, truncation, numeric/null semantics, sorting, encodings, malformed JSONL, large numeric values, and query results. The same semantic operation must not silently change meaning because a different backend was selected.

### 6.4 Deterministic backend selection

| Operation shape | Preferred implementation | Upgrade trigger |
|---|---|---|
| Literal/regex search | Direct Pi grep/ripgrep | Benchmark-proven deficiency |
| Known file/range | Direct bounded Pi read | Verified reusable cache benefit |
| Small one-off structured transform | Bounded codemode | Repeated/high-cost shape |
| Large one-pass JSONL | Native line streaming + early filters/aggregation | None initially |
| Repeated/complex stable JSONL | Streaming initially | Verified indexing amortization and freshness |
| Git | Typed fixed argv and `shell:false` | Equivalent verified library/backend |
| Validation | Trusted named runner in isolation | Cache only with reliable input identity |

The dispatcher must choose the **lowest-overhead eligible correct backend**, not merely the fastest parser in isolation. No extra LLM decides backend choice. Criteria: operation shape, result cardinality, repetition, cached/indexed state, access policy, source freshness. Never trade correctness or security for latency.

### 6.5 JSONL implementation requirements

- Stream records incrementally, parse one record at a time, apply predicates immediately.
- Project only requested fields; aggregate in-process; bound returned row count/bytes.
- A top-k or global sort must document its actual memory bound; do not claim constant memory if accumulating records.
- Return `recordsScanned`, `recordsMatched`, `recordsReturned`, `truncated`, elapsed time, and source fingerprint when available.
- Cache by source identity + semantics + policy scope; invalidate on writes; fall back safely if cache state is uncertain.
- Introduce SQLite/DuckDB-style indexing only after benchmarks show repeated workloads amortize index-build costs.

### 6.6 Capability gaps

On unsupported legitimate intent, return a typed `CAPABILITY_GAP` with requested outcome and missing semantic capability. Do not fabricate completion, silently stall, or emulate arbitrary bash with codemode. Surface failure to the **turn invoker** in the originating turn: human-visible result interactively, structured failure for SDK/headless callers (Q9). Instrument denied requests and escalation attempts without logging secrets.

## 7. Isolation architecture

### 7.1 Protection levels

**Tool-restricted:** Bash absent; policy-gated model tool calls; controlled process backends. Strongly reduces routine accidental commands; **does not** claim containment of arbitrary Node execution inside other extensions.

**Fully isolated:** The **entire Pi process, including loaded extensions**, runs under an OS/container/VM boundary with limited host mounts, identity, credentials, process privileges, and network. This is the required basis for a strong S10b cross-package/internal-process containment claim.

Sandboxing only a `bash` subprocess, or only operations routed through an `ExecutionEnv`, does **not** automatically constrain the Pi process running extension code (SOURCE-CONFIRMED: the sandbox example wraps the command a tool spawns via `wrapWithSandbox` + `spawn`; gondolin routes built-in *tools* into a micro-VM; `ExecutionEnv` is not exposed on `ExtensionAPI`). Distinguish process-scope and tool-scope isolation in `/nobash-status`.

### 7.2 Baseline isolation controls

- Disposable/isolated checkout or worktree; minimum necessary mounts; never mount the home directory or host secrets broadly.
- Dedicated unprivileged user; deny privileged syscalls/mounts where supported; configurable network restriction.
- CPU, memory, elapsed-time, output and process-count limits appropriate to platform.
- OS-level prevention of access outside the authorized scope, rather than only extension path checks.
- Explicit platform matrix (Linux/macOS/other) with supported mechanisms and actual tested claims. Unsupported isolation methods must be reported UNVERIFIED, not silently replaced by unsandboxed execution.

## 8. Observability and failure contracts

### 8.1 Required records

Capture operation, selected backend, allow/deny, role/agent, run/session ID, timestamp, elapsed time, bytes read/returned, records scanned/returned, truncation, cancellation state, exit/error class, cache status and security-boundary state where available. Redact secrets; avoid logging complete untrusted prompts or file contents by default.

Error classes: `POLICY_DENIED`, `CAPABILITY_GAP`, `INVALID_REQUEST`, `OUT_OF_SCOPE_PATH`, `TIMEOUT`, `CANCELLED`, `TRUNCATED`, `EXECUTION_FAILURE`, `BACKEND_MISMATCH`, `GATE_FAILED`, `ISOLATION_UNVERIFIED` (names may adapt; meanings stable).

### 8.2 Startup failure behavior

A red gate must: reject supported inputs, block unauthorized tool calls, report a deterministic reason to invokers, attempt active abort if warranted, and optionally request shutdown while preserving blocking state. No generic warning-and-continue mode is permitted for sessions claiming protection.

If the extension never loads, none of its hooks or status command can run; this is an explicit v1 deployment-scope limit, not a successful enforcement test.

### 8.3 Cancellation reporting

Maintain separate fields for `abortRequested`, `localAgentStopped`, `providerStreamStopped`, and `remoteTransmissionAlreadyStarted` when observable. Acknowledge unknowns. Never interpret local cancellation as proof the provider received no data.

## 9. Verification plan (mandatory before protected release)

Guarantees are RUNTIME-VERIFIED only when their target passes on a real Pi runtime at the pin, and on the declared floor (0.84.2).

### 9.1 V0: pinned API/source confirmation and attestation feasibility

**V0-SOURCE.** Before coding the main extension, independently re-check the pinned checkout and record commit, package metadata, and source locations for: extension registration/load order; `input` event and `handled` short-circuit; tool-call result and `terminate` batch semantics; `getActiveTools()`; `ctx.abort()` and `ctx.shutdown()`; session `prompt`/`steer`/`followUp`; lower-level `agent.prompt`/`agent.continue`; `before_provider_request`; trust/settings load; construction-time `defaultTools` resolution vs `session_start` (confirm the §4.1 correction per mode); programmatic SDK initialization. Every changed signature requires explicit adaptation and retest.

**V0-HOOK — Enforcement attestation (OPEN feasibility; release-blocking).** Pi exposes no general hook-introspection API (SOURCE-CONFIRMED, SF8). Interception evidence must come from a canary traversing the real dispatch path. `ctx.executeTool()` runs a tool "through the same validation, hooks, and permission checks as model-issued calls" (SOURCE-CONFIRMED, SF8), so a canary that sets the gate red and calls `executeTool()` on a **harmless, permitted, side-effect-free** probe tool, then asserts a blocked result, exercises actual interception. Calling the handler function directly is insufficient — it tests logic, not installation.

V0 must implement or rule out such a probe. The canary passes only when: (a) the red gate deliberately denies it; (b) the probe's side-effect marker remains untouched; (c) an identifiable denial is observed; (d) no recursion or competing-handler interaction defeats the test; and (e) timing permits completion before protected admission.

**Two gates are distinct, and must not be conflated.** The `tool_call` guard enforces G1 **independently of the canary** — it fails closed on a red gate whether or not attestation has run. The canary determines only whether `/nobash-status` may report *verified* interception. V0-HOOK is nevertheless part of the initial release verification requirements. The four outcomes and their consequences:

| V0-HOOK outcome | Consequence |
|---|---|
| Pre-turn canary succeeds (a–e hold) | Diagnostic may report `hookRegistration: "verified"`; the V0-HOOK requirement passes. |
| Canary executes but interception fails (probe not blocked) | The hook is not intercepting: **startup gate red; release blocked.** |
| Pre-turn canary proves technically unavailable (e.g. `executeTool` not reachable before first turn) | Investigate an alternative attestation (e.g. first-tool-call attestation) and record the precise lifecycle obstacle; **do not silently count this as passing.** A functioning `tool_call` guard is not thereby made nonfunctional, but the verified diagnostic may not be asserted without an accepted alternative. |
| Only registration is known (no dispatch-path evidence) | Diagnostic says `self-reported`, **never** `verified`. |

This preserves the release requirement without implying that a working guard becomes nonfunctional because attestation is unavailable, and prevents a late implementation decision from silently weakening the spec. `hookRegistration` remains `verified | self-reported | unverified`; the latter two may never be displayed as a verified hook.

### 9.2 A1: mode × entry-path admission matrix (G2)

Run with gate forced red. Applicability vocabulary: **SUPPORTED** = source-traced entry path requiring a runtime test; **UNVERIFIED** = availability unresolved, V0 must inspect; **N/A** = source conclusively establishes the path is unavailable (record evidence). Do not convert UNVERIFIED to N/A by assumption. The cell annotation names the test that owns it (A1 for fresh-turn G2; A2 for continuation G1).

| Mode | Normal prompt | Steer | Follow-up | Queued / continuation |
|---|---|---|---|---|
| Interactive | SUPPORTED / A1 | UNVERIFIED / V0 | UNVERIFIED / V0 | A2 (continuation; trace exact path) |
| Print | SUPPORTED / A1 | UNVERIFIED / V0 | UNVERIFIED / V0 | UNVERIFIED / V0 |
| RPC | SUPPORTED / A1 | SUPPORTED / A1 | SUPPORTED / A1 | UNVERIFIED / V0 applicability; A2 for continuation |
| SDK `session.*` | SUPPORTED / A1 | SUPPORTED / A1 | SUPPORTED / A1 | UNVERIFIED / V0 applicability; A2 for continuation |

**Guarantee routing (important):** continuations bypass the `input` event, so a queued/continuation turn is **never a G2 cell** — it receives no automatic G2 admission guarantee. Its tool calls are assessed under A2 (G1) and its provider activity under conditional A3 (G3). Only fresh supported entries are G2/A1 cells.

Assertions for G2/A1 cells: a fresh supported input is consumed before any model turn begins; no model call starts; an invoker-visible denial occurs; no silent retry or subsequent admission. Exercise input-event precedence with other installed handlers. Source tracing must resolve every UNVERIFIED cell before the coverage report is finalized. **Direct `session.agent.prompt()` is an explicit lower-level SDK bypass outside the extension's admission guarantee**; exercise as a negative scope demonstration (A4), not as a passing protected entry point.

### 9.3 A2: tools, continuations and batches (G1)

Test with gate red initially and after a green admission:

- Direct `bash` forcibly re-exposed via settings/CLI; the tool call is denied before execution.
- Built-in and custom tools under deny policy; no unauthorized file/network/process side effects occur.
- Nested tool calls via the policy-aware dispatcher vs a deliberate `.execute()` bypass attempt.
- `agent.continue()` and automatic retries/compaction/steering after the gate goes red; every resulting tool call is blocked.
- Mixed authorized/blocked tool batches; independently prove **per-call blocking** even when `terminate:true` does not end the batch (test the pinned semantics: termination only when every finalized result requests it).
- Cross-package model tool and direct extension-internal `execFile`; the first must obey policy, the second must be evaluated at the OS isolation boundary (A5), not expected to be hook-blocked.
- Guard fail-safe: a throwing `tool_call` handler results in the tool being blocked.

**Pass:** zero unauthorized Pi-intercepted tool side effects in every supported test, with deterministic denial metadata. This test does **not** prove a no-tool continuation stopped provider activity (that is G3/A3).

### 9.4 A3: in-flight provider cancellation (G3, conditional, forward-only)

With a controlled mock provider, start a long/streaming request, turn the gate red during it, then invoke the supported active-operation abort path. Assert and record:

1. abort reached the active operation;
2. no additional tool execution occurred;
3. no new provider request started after the red gate;
4. whether the local stream stopped, and when;
5. whether bytes had already reached the provider (**do not claim reversal**);
6. whether the caller obtained a clear `stopped`, `failed`, or `uncertain` result.

Include retries, queueing, and provider errors. Distinguish **preventing new calls** from **cancelling a request that already started**. Since the pinned `before_provider_request` contract documents no blocking return, do not rely on a pre-request block from that hook.

**Release rule:** G3 is RUNTIME-VERIFIED only when the tested runtime/provider combinations demonstrate the specified forward-only cancellation semantics. Otherwise report G3 as limited/unknown while retaining G1/G2 claims if passed. G3 must not require proof that transmitted data was recalled.

### 9.5 A4 and A5: explicit boundary tests

- **A4:** Demonstrate that lower-level direct SDK agent-driving paths can bypass the session `input` hook. Treat untrusted SDK embedders and an unloaded package as requiring a launcher/host-level boundary; they are outside v1 in-extension guarantees. This is a documentation/negative-demonstration test, not a containment test.
- **A5:** Demonstrate that tool-only sandboxing does not constrain arbitrary extension-internal Node process execution, whereas correctly configured whole-process containment blocks forbidden host effects. Use disposable test files, not real home-directory data. A5 is required before any "protected execution"/containment claim.

### 9.6 Functional and performance matrix

| Workload | Differential correctness | Cost/performance metrics |
|---|---|---|
| Fixed/regex search | Same expected matches under specified regex/ignore semantics | elapsed, tokens, output, calls |
| File discovery/range read | Same paths/content | latency, context bytes |
| Small JSON | Same extracted value/types | tool turns, CPU |
| Large JSONL count/group | Exact counts, malformed policies | wall time, peak memory, records read/returned |
| Repeated JSONL | Same results after edit/invalidation | cold/warm index/cache amortization |
| Git | Same state/diff, pathspec boundaries | startup, output, correctness |
| Validation | Same check exit and relevant diagnostics | runtime, cancellation, output bounds |
| Full engineering tasks | Same completion criteria or explicit intentional denial | median/p95 total time, token cost, task success |

Use the same pinned model, repository snapshot, hardware, and fixtures where possible; repeat enough runs to assess variance. Optimizations are accepted only when repeatably beneficial without breaking correctness or permissions.

### 9.7 Adversarial suite (R2b)

Must include direct destructive shell request, alternative deletion path, interpreted agent-written script, package-script execution, path traversal/symlink race, prompt injection through repository files, secret reads/exfiltration, nested-call bypass, unauthorized profile elevation, cache cross-scope leakage, malicious companion tool, and direct extension-internal `execFile`. Record concrete blocked/contained outcomes, not just the presence of hooks. Re-run on any tool/allowlist/backend/policy/isolation change.

## 10. Acceptance traceability

| Product acceptance | Technical evidence |
|---|---|
| AC1 activation | package/settings/trust integration tests; solo and project |
| AC2 tool removal | `pi.getActiveTools()` snapshots under configured scope |
| AC3 interception | re-exposed bash denied before side effects |
| AC4 startup R2a | A1 (G2) + A2 (G1); known missing-package limit documented |
| AC5 runtime R2b | adversarial and composition suite (9.7) |
| AC6 coverage | representative tasks, `CAPABILITY_GAP` and in-turn errors |
| AC7 restricted permissions | write/process denied across direct and nested tools |
| AC8 isolation | forbidden paths/credentials inaccessible in chosen sandbox (A5) |
| AC9 semantic correctness | differential fixtures |
| AC10 performance | paired task-level benchmark report (9.6) |
| AC11 diagnostics | `/nobash-status` shows distinct verified/self-reported/unknown states |
| AC12 deactivation | both-control removal, partial-state verification |
| AC13 headless/peers | independently gated SDK/headless instances |
| AC14 mid-session | red-state transition, retry/continuation/cancellation tests |
| AC15 escalation | config-gated escape hatch; self-elevation denied |
| AC16 cross-package | tool-call policy and process containment tested separately |

## 11. Ordered implementation plan

**Phase 0 — feasibility harness (release blocker):** Pin `6fb2e78`; run V0-SOURCE; resolve V0-HOOK (dispatch-path canary feasibility and pre-turn timing); build a minimal extension/mock runner; execute A1 and A2 including continuations and batching; exercise A3 independently; verify loader/trust/settings chronology per mode. Do not claim G1/G2 until A1/A2 pass.

**Phase 1 — package and diagnostics:** Build package manifest; settings examples; red-by-default hooks and verified gate; `/nobash-status` (with `hookRegistration` driven by the V0-HOOK canary); compatibility check; interactive/team/headless activation and deactivation tests. Keep the missing-component limitation explicit.

**Phase 2 — core engineering replacements:** Reuse Pi built-in reads/search/edits; implement `query_jsonl` first (highest measured legacy usage for inline JSON), then typed Git and named validation, then smaller general capabilities as demand requires. Add policy-aware nested calls and the common constrained executor.

**Phase 3 — safety boundary:** Enforce profile, paths, arguments, environment and return scope; enable reproducible isolated execution; test whole-process isolation including independent extensions (A5); permit the escape hatch only under trusted configuration and verified isolation.

**Phase 4 — coverage and optimization:** Replay representative previously bash-enabled tasks; instrument unmet intent; run differential/adversarial suites; benchmark backend selection and end-to-end task metrics; document explicit performance tradeoffs.

**Phase 5 — release gate:** Produce an evidence bundle linking version, config, test results, coverage, isolation mode, and limitations. Advertise only verified protection levels. No self-certified green status in place of executed tests.

## 12. Open items and blockers

The two release-blocking runtime unknowns are **V0-HOOK** (safe pre-turn dispatch-path canary) and **A1/A2** (G2 entry-path refusal; G1 interception across continuations and batches). **A3** is conditional (gates G3 only). The remaining items are source-trace or separate-level work.

| ID | Open item | Status | Resolution artifact |
|---|---|---|---|
| **Q1** | Does red-gate `input` cover every supported fresh entry with other extensions loaded? | release-blocking | A1 |
| **Q2** | Does `tool_call` interception cover continuation batches and nested calls with correct `terminate` semantics? | release-blocking | A2 |
| **Q3** | Can a safe dispatch-path canary attest interception before the first protected turn? (`ctx.executeTool` is the primitive; pre-turn timing open) | release-blocking | V0-HOOK |
| **Q3b** | Does `ctx.abort()` stop local provider activity promptly and report outcome? | conditional (G3) | A3 |
| **Q4** | Loader/order behavior for trust, settings, construction-time `defaultTools`, hook registration and first input in every mode (confirm §4.1 correction per mode) | source-trace | V0-SOURCE |
| **Q5** | Exact 1.1.0 SDK/package compatibility and peer-dependency checks | source-trace | V0-SOURCE / manifest |
| **Q6** | Which whole-Pi-process isolation profiles work per target OS | separate-level | A5 / platform tests |
| **Q7** | Who controls escape-hatch configuration for interactive and headless use | SPECIFIED contract | trusted-config design |
| **Q8** | Which effective settings/package changes are detectable during live sessions | source-trace | runtime change tests |
| **Q9** | Which Pi/SDK event/result best surfaces a same-turn capability gap | source-trace | interactive/headless tests |
| **Q10** | Should a future launcher verify package presence before Pi starts | out of v1 | future product decision |
| **Q11** | What coverage/performance numbers constitute release readiness | SPECIFIED after baseline | benchmark report |
| **Q12** | Does print mode expose steer/followUp/queued paths (prevents a guessed N/A in the A1 matrix)? | source-trace (SF3) | V0-SOURCE |

## 13. Release security claims and verification tiers

### 13.1 Verification tiers (what evidence unlocks what)

| Tier | Evidence | Unlocks |
|---|---|---|
| **Initial G1/G2 release blockers (runtime)** | **V0-HOOK**, **A1**, **A2** | Attested hook diagnostic; scoped G2 supported fresh-turn refusal; scoped G1 Pi-intercepted tool-call denial |
| **Conditional provider level** | **A3** | G3 forward-only cancellation for tested provider/runtime configurations; not required to ship G1/G2 |
| **V0 source-trace prerequisites** | Activation order per mode (SF10), print-mode matrix applicability (SF3), manifest/peer-dependency trace | Accurate integration/compatibility contracts; not standalone runtime enforcement proofs |
| **Separate containment level** | **A5** + **R2b adversarial suite** | Claims about whole-process isolation and execution containment; never implied by passing G1/G2 |

### 13.2 Claims permitted only after corresponding runtime evidence

Allowed **only after corresponding runtime evidence**:

- **"Bash is removed from the model-facing toolset"** — when effective tool inspection (`getActiveTools()`) verifies absence.
- **"Unauthorized tool execution is blocked"** — when G1/A2 passes for supported Pi-intercepted tool-call paths (scope per §2.1).
- **"New supported session turns are refused under a failed gate"** — when G2/A1 passes.
- **"Interception is verified (not merely registered)"** — when the V0-HOOK dispatch-path canary blocks its probe.
- **"Provider activity cancellation is verified"** — only for tested G3/A3 runtime/provider cases, with honest uncertainty and no suggestion of unsending requests.
- **"Extension-internal execution is contained"** — only when whole-process OS isolation (A5) was actually verified for the stated environment.

Never claim automatic enforcement when the package fails to load or when an SDK embedder bypasses the session-level APIs; these require a separate host/launcher trust boundary.

At v1 release, absent G3/A3, the product's protection statement reads: *"Once tested, pi-nobash refuses new turns through supported entry points and refuses unauthorized Pi-intercepted tool calls (including continuations and batches). It does not comprehensively suppress already-running provider activity, does not contain extension-internal or untrusted executable code without a configured whole-process isolation boundary, and does not protect sessions where its component is not loaded or where an embedder drives the agent beneath the session API."*

**Final engineering rule:** The model chooses a typed operation; trusted runtime code chooses a bounded, authorized implementation. The extension must prevent unsupported work through verified hooks and policy, and the OS boundary must constrain executable behavior those hooks cannot observe.

## 14. Primary implementation references

- Pinned Pi source: `https://github.com/earendil-works/pi/tree/6fb2e78`
- Coding-agent extension docs: `.../6fb2e78/packages/coding-agent/docs/extensions.md`
- Coding-agent SDK docs: `.../6fb2e78/packages/coding-agent/docs/sdk.md`
- Package docs: `.../6fb2e78/packages/coding-agent/docs/packages.md`
- Settings docs: `.../6fb2e78/packages/coding-agent/docs/settings.md`
- Agent session source: `.../6fb2e78/packages/coding-agent/src/core/agent-session.ts`
- Extension types: `.../6fb2e78/packages/coding-agent/src/core/extensions/types.ts`
- Extension loader: `.../6fb2e78/packages/coding-agent/src/core/extensions/loader.ts`
- RPC / print modes: `.../6fb2e78/packages/coding-agent/src/modes/rpc/rpc-mode.ts`, `.../src/modes/print-mode.ts`
- Sandbox / gondolin examples: `.../6fb2e78/packages/coding-agent/examples/extensions/sandbox/index.ts`, `.../gondolin/index.ts`
- Env package: `.../6fb2e78/packages/env/README.md`
- Pi security docs: `.../6fb2e78/packages/coding-agent/docs/security.md`
- Adversarial reference: `https://github.com/disler/bash-damage-from-within`

Source locations were inspected at the pinned checkout in this project's investigation (SOURCE-CONFIRMED, reported inspection). **No live Pi runtime tests, provider-cancellation tests, or sandbox-escape tests were run while drafting this document.** V0 re-checks each against the pinned tree before implementation relies on it.
