# pi-nobash — Technical Implementation Specification v1.0

**Status:** Implementation draft; unresolved feasibility gates explicitly identified  
**Date:** 2026-10-08  
**Product:** `pi-nobash`  
**Target source baseline:** `earendil-works/pi` commit `6fb2e78`, `@earendil-works/pi-coding-agent` 1.1.0  
**Purpose:** Specify the package, enforcement mechanisms, semantic tools, execution boundaries, verification, and phased implementation needed to replace model-facing bash without losing routine engineering functionality.

## 1. Scope, authority, and evidence

This is a **standalone build specification**. The package is opt-in. It removes `bash` from normal model-facing tools using Pi settings, blocks prohibited tool calls using an extension, and supplies typed, efficient alternatives. It does not remove all process execution. Controlled Git, builds, tests, linters, and project utilities remain necessary.

**Evidence labels used below:**

- **Source-supported (pin):** APIs and paths identified by source inspection against commit `6fb2e78` / package 1.1.0 in the project investigation. Recheck against the exact pinned tree before implementing: these findings have not been reproduced by an executable test in this specification.
- **Specified:** a product/design decision that implementers must satisfy; not a claim that Pi offers the required primitive automatically.
- **Unverified:** requires a reproducible source review, integration test, or runtime experiment before claiming the behavior is supported.

**Source baseline and verification caveat:** The pinned source references were provided and examined in project discussion. Direct retrieval of the pinned GitHub pages was unavailable during preparation of this document. Therefore API signatures, event handling, and cited line numbers are *investigation inputs*, not independently reverified source evidence. Build work must first inspect the pinned commit and record the corresponding symbols/locations. Later Pi releases are not assumed equivalent.

### 1.1 Product goals

1. Remove unrestricted model-facing `bash` as the default operation interface.
2. Preserve read/search/edit, structured-data inspection, Git, and validation tasks using safe purpose-built capabilities.
3. Enforce separate authorization, operation-policy, and OS-isolation boundaries.
4. Prefer lower end-to-end latency, fewer model turns, bounded output, and repeatable correctness over superficial subprocess microbenchmarks.
5. Support solo and project/team adoption with reliable diagnostics and reversible deactivation.

### 1.2 Non-goals and scope limits

- No universal security claim for unloaded extensions, arbitrary untrusted SDK embedders, or host process execution outside an isolation boundary.
- No attempt to blacklist all dangerous shell strings or to expose unrestricted Python/Node/jq/SQL through renamed tools.
- No mandatory launcher for v1. A host/launcher check for *missing enforcement component* is a future option.
- No automatic policy hot-reload. A fresh Pi process is the supported transition for configuration/activation changes.
- No guarantee that cancelling a provider stream recalls data already transmitted.
- No universal performance improvement without task-level measurements.
- No bundled project-specific utilities such as `herdr` or `fallow`; those belong in optional companion packages.

## 2. Terminology and invariant boundaries

**Protected session:** A Pi session configured to use, or currently using, the `pi-nobash` profile. **Protected turn:** A turn within such a session, including when protection was intended but initialization failed. A missing `-bash` setting does not quietly change a protected turn into an unprotected one.

**Gate:** Runtime state checking required protection preconditions. **Green:** all *required and verified* startup conditions pass. **Red:** any required condition fails or cannot be established. **Unknown:** a condition cannot be tested; for required startup conditions, unknown must act as red.

**Model-facing exposure:** tools returned by the effective Pi tool-selection state, as observed by `pi.getActiveTools()`. This answers *what is presented*, not *what can execute*.

**Tool enforcement:** interception of Pi tool calls. **Execution containment:** an OS/container/VM boundary covering the relevant processes. A tool hook does not intercept a separate extension's direct `child_process.execFile()` call.

### 2.1 Three R2a guarantees (different strength)

| ID | Claim | Primary candidate | Evidence / release status |
|---|---|---|---|
| **G1** | Under a red gate, no unauthorized **tool-mediated execution** occurs | `tool_call` returning `block:true`, optionally `terminate:true` | Source-supported API; requires A2 tool/batch/continuation tests |
| **G2** | Under a red gate, new agent turns are refused through **supported session entry points** | `input` returning `{action:"handled"}` | Source-supported paths; requires A1 mode × entry-path tests |
| **G3** | An existing model/provider operation is cancelled after a gate becomes red | `ctx.abort()` candidate | Conditional; requires A3 runtime tests, outcome reporting; cannot undo transmission |

**Claim policy:** G1 and G2 may be advertised only after their coverage tests pass on the supported runtime. G3 is **not** included in the v1 mandatory comprehensive cancellation claim unless A3 demonstrates it. G3 must not block release of correctly scoped G1/G2, but failure must be observable and protection must not be misrepresented.

### 2.2 R2a versus R2b

- **R2a, presence/admission:** loaded enforcement component, supported Pi, active settings, effective tool exposure, pre-turn refusal, tool-call blocking, and diagnostic reporting. Failing gate prevents supported fresh turns and tool-mediated work.
- **R2b, runtime coverage:** compositions and alternative execution paths, path/argument checks, cross-package tool calls, validation scripts, symlinks, secrets, and OS isolation. Verified using an adversarial suite, not startup self-reporting.

## 3. Distribution and lifecycle

### 3.1 Deliverable layout (proposed)

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

**Package manifest** (conceptual; validate the exact package schema at the pin):

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

**Important:** This is a planning example, **not an approved final manifest**. Verify which `@earendil-works/*` packages are actually imported and the host's package-manager expectations; declare only necessary peer dependencies, do not bundle Pi-host packages, and implement explicit runtime compatibility checks. The known historical reason for checking at least 0.84.2 is a fix where `defaultTools` could drop extension/SDK custom tools when selecting built-in defaults. The implementation target is **1.1.0 / `6fb2e78`**, not an untested assertion of compatibility with every later version.

**Project settings** (example to validate against the pin):

```json
{
  "packages": ["git:github.com/<owner>/pi-nobash@<pinned-ref>"],
  "defaultTools": ["-bash", "+grep", "+find", "+ls", "+codemode"]
}
```

- Package resources register replacement tools, hooks, and skills.
- `defaultTools` in **Pi settings** removes built-in bash; it is not embedded in the package manifest.
- The extension's `tool_call` hook blocks execution as an independent backstop.
- A CLI or SDK tool selection override may re-expose bash: the gate must detect exposure and remain red; the hook still blocks calls when loaded.
- Project trust and first-launch package installation behavior must be validated in integration tests, including noninteractive processes.

### 3.3 Activation scenarios

| Scenario | Required steps | Expected result |
|---|---|---|
| Solo | Install pinned package into user scope, configure user `defaultTools`, restart | Gate runs before supported agent turns; no model-facing bash |
| Team | Commit one `.pi/settings.json` with both `packages` and `defaultTools`; contributor opens and trusts project | Automatic package/settings loading on supported Pi; no per-person manual configuration after trust |
| Headless/SDK | Supply effective package/resources/tool settings and trust explicitly for each independent process | Every claimed-protected instance independently passes gate |
| Partial state | Package loaded but `-bash` absent, or package removed but `-bash` remains | First is reported red/partial by loaded package; second cannot be detected by an unloaded package |
| Deactivation | Remove both package and `-bash` settings, restart | Normal Pi selection returns, subject to other settings |

**Missing-component limitation:** An unloaded extension cannot refuse a session. No v1 claim covers a project that has a stale `-bash` setting but no functioning `pi-nobash` code. A trusted launcher or host-level check would be required for that stronger claim.

### 3.4 Mid-session changes

- Treat last gate-evaluated effective state as the current documented status, with a timestamp.
- Activating/deactivating/updating security settings requires restart for supported behavior.
- When any required policy condition is **known** to have weakened, turn red immediately and reject subsequent intercepted turns and tools.
- Detecting arbitrary external file/package changes is not guaranteed; document observed vs unknown state.
- If the runtime supports a reliable tool-change event, it may invalidate the gate; do not assume hot-reload fully revokes old tools.

## 4. Extension startup and red-gate control

### 4.1 Startup order (specified; implementation sequence to verify)

```text
extension module loads
  -> register red-by-default shared gate state
  -> register input handler, tool_call blocker, diagnostic command
  -> register typed tools
  -> inspect running Pi version and required APIs
  -> inspect getActiveTools() / expected registered tools
  -> verify configured policy/mode and required isolation preconditions
  -> mark gate GREEN only when every mandatory check passes
  -> allow supported new turns / authorized tool calls
```

**Required property:** No interval during which protection is claimed but hooks are absent and agent work is admitted. Verify hook registration ordering in the pinned extension loader, not merely the order written in extension source. If hooks cannot be active before the first turn, the deployment design must change before claiming G2.

### 4.2 Source-level hook contracts (pin-dependent)

The pinned-source investigation identified these candidates:

- `input` handler returning `{ action: "handled" }` short-circuits eligible input before agent run. The investigation cites `_runInputHandlers` in `agent-session.ts` and the early return near line 1928.
- `tool_call` can return a blocked result with a reason; a source-identified `terminate?: boolean` requests stopping after the current tool batch **only when every finalized result in that batch sets it**. Per-call blocking is the actual safety condition. Validate the exact return schema before writing code.
- `ctx.abort()` aborts the active agent operation via its cancellation path but does not undo network transmission. `ctx.shutdown()` is secondary, reportedly deferred until idle in interactive mode and ineffective in print mode. Neither substitutes for the guards.
- `BeforeAgentStartEventResult` is `{ message?, systemPrompt? }` at `6fb2e78`; `systemPromptOptions` is an **event** property, not a result field. There is no documented cancel result; **do not use `before_agent_start` as a guard**.
- `before_provider_request` has no documented reject/block contract at this pin. Do not invent one.
- The observed public session paths use `session.prompt()`, `session.steer()` and `session.followUp()`; their input-handler coverage requires an executable matrix test. Lower-level `session.agent.prompt()` / `agent.continue()` can bypass input processing.

These are **implementation leads**, not an assertion that an unexecuted prototype is safe.

### 4.3 Red-gate behavior

Pseudocode illustrating policy, **not a copy-paste SDK signature**:

```ts
const gate = { state: "RED", reason: "not verified", evaluatedAt: null };

onInput(async (event, ctx) => {
  if (gate.state !== "GREEN") {
    reportEnforcementFailure(event, gate);
    return { action: "handled" }; // prevent eligible agent admission
  }
  return { action: "continue" }; // replace with exact pinned API behavior
});

onToolCall(async (event, ctx) => {
  if (gate.state !== "GREEN" || !authorize(event, currentPolicy)) {
    auditDeny(event, gate);
    return { block: true, terminate: gate.state !== "GREEN", reason: reasonFor(event) };
  }
});
```

**Avoid relying on source order alone:** Some SDK entry paths bypass `input`, and one handler can consume input before later handlers see it. Verify handler interactions with other extensions and fail-safe behavior. All registered model tools must enforce authorization in their own trusted execution path as well, not only in global hooks.

### 4.4 Shutdown and cancellation

- Attempt `ctx.abort()` when an active operation must be cancelled after a detected gate failure, if supported in that context.
- `ctx.shutdown()` may be requested as **secondary cleanup**, never as the primary admission or tool guard.
- Preserve a red guard until the process actually exits; do not clear it merely because shutdown was requested.
- Report cancellation as `requested`, `observed stopped`, `failed`, or `unknown`; do not claim remote/provider-side recall.

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
  "coverage": { "suiteRevision": "...", "lastResult": "pass|fail|not-run|unknown" }
}
```

Separate **presented tools**, **hook registration/effectiveness**, **sandbox status**, and **last adversarial suite evidence**. Self-registration is not equivalent to demonstrated interception. An unknown required condition must not be displayed green. An unloaded package cannot provide this command.

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
- A separate third-party extension's direct `execFile` or arbitrary Node code is **not** hook-controlled. Whole-process isolation is the applicable containment boundary; without it, this code lies outside the enforceable cross-package promise.

### 5.4 Common execution service

Provide a trusted helper for process-oriented typed operations, with:

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

Use Pi `read`, `grep`, `find`, `ls`, `edit`, `write` without forcing every call through a universal semantic dispatcher. Use `grep` with `literal:true` for fixed text, regex only when required, `find` for discovery, and bounded `read` after locating relevant ranges. Respect effective role permissions on these built-ins.

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

Optional rendering/conversion remains a narrow later capability. User-specific `herdr` and `fallow` are companion packages, not core tool dependencies.

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

The dispatcher must choose the **lowest-overhead eligible correct backend**, not merely the fastest parser in isolation. No extra LLM decides backend choice. Criteria include operation shape, result cardinality, repetition, cached/indexed state, access policy, and source freshness. Never trade correctness or security for latency.

### 6.5 JSONL implementation requirements

- Stream records incrementally, parse one record at a time and apply predicates immediately.
- Project only requested fields; aggregate in-process; bound returned row count/bytes.
- A top-k or global sort must document its actual memory bound; do not claim constant memory if accumulating records.
- Return `recordsScanned`, `recordsMatched`, `recordsReturned`, `truncated`, elapsed time, and source fingerprint when available.
- Cache by source identity + semantics + policy scope; invalidate on writes, and fall back safely if cache state is uncertain.
- Only introduce SQLite/DuckDB-style indexing after benchmarks show repeated workloads amortize index-build costs.

### 6.6 Capability gaps

On unsupported legitimate intent, return a typed `CAPABILITY_GAP` with requested outcome and missing semantic capability. Do not fabricate completion, silently stall, or emulate arbitrary bash with codemode. Surface failure to the **turn invoker** in the originating turn: human-visible result interactively, structured failure for SDK/headless callers. Instrument denied requests and escalation attempts without logging secrets.

## 7. Isolation architecture

### 7.1 Protection levels

**Tool-restricted:** Bash absent; policy-gated model tool calls; controlled process backends. Strongly reduces routine accidental commands; **does not** claim containment of arbitrary Node execution inside other extensions.

**Fully isolated:** The **entire Pi process, including loaded extensions**, runs under an OS/container/VM boundary with limited host mounts, identity, credentials, process privileges, and network. This is the required basis for a strong S10b cross-package/internal-process containment claim.

Sandboxing only a `bash` subprocess or only operations routed through an `ExecutionEnv` does **not** automatically constrain the Pi process running extension code. Distinguish process-scope and tool-scope isolation in `/nobash-status`.

### 7.2 Baseline isolation controls

- Disposable/isolated checkout or worktree; minimum necessary mounts; never mount the home directory or host secrets broadly.
- Dedicated unprivileged user; deny privileged syscalls/mounts where supported; configurable network restriction.
- CPU, memory, elapsed-time, output and process-count limits appropriate to platform.
- OS-level prevention of access outside the authorized scope, rather than only extension path checks.
- Explicit platform matrix (Linux/macOS/other) with supported mechanisms and actual tested claims. Unsupported isolation methods must be reported unverified, not automatically replaced by unsandboxed execution.

## 8. Observability and failure contracts

### 8.1 Required records

Capture operation, selected backend, allow/deny, role/agent, run/session ID, timestamp, elapsed time, bytes read/returned, records scanned/returned, truncation, cancellation state, exit/error class, cache status and security-boundary state where available. Redact secrets and avoid logging complete untrusted prompts or file contents by default.

Errors: `POLICY_DENIED`, `CAPABILITY_GAP`, `INVALID_REQUEST`, `OUT_OF_SCOPE_PATH`, `TIMEOUT`, `CANCELLED`, `TRUNCATED`, `EXECUTION_FAILURE`, `BACKEND_MISMATCH`, `GATE_FAILED`, `ISOLATION_UNVERIFIED` (names may be adapted, meanings remain stable).

### 8.2 Startup failure behavior

Red gate must: reject supported inputs, block unauthorized tool calls, report a deterministic reason to invokers, attempt active abort if warranted, and optionally request shutdown while preserving blocking state. No generic warning-and-continue mode is permitted for sessions claiming protection.

If extension never loads, none of its hooks or status command can run; this is an explicit v1 deployment-scope limit, not a successful enforcement test.

### 8.3 Cancellation reporting

Maintain separate fields for `abortRequested`, `localAgentStopped`, `providerStreamStopped`, and `remoteTransmissionAlreadyStarted` when observable. Acknowledge unknowns. Never interpret local cancellation as proof the provider received no data.

## 9. Verification plan (mandatory before protected release)

### 9.1 V0: pinned API/source confirmation

Before coding the main extension, record a checked-out commit, package metadata and source locations for: extension registration/load order; `input` event and `handled` short-circuit; tool-call result and `terminate` batch semantics; `getActiveTools()`; `ctx.abort()` and `ctx.shutdown()`; session prompt/steer/followUp; lower-level agent `continue`; provider request hook; trust/settings load; programmatic SDK initialization. Every changed signature requires explicit adaptation and retesting.

### 9.2 A1: mode × entry-path admission matrix (G2)

Run with gate forced red. Exercise **only supported combinations**, mark others N/A:

| Mode | Normal prompt | Steer | Follow-up | Queued/continuation |
|---|---|---|---|---|
| Interactive | Test | Test if supported | Test if supported | Test |
| Print | Test | N/A unless supported | N/A unless supported | Test if supported |
| RPC | Test | Test | Test | Test |
| SDK/session API | Test | Test | Test | Test |

Assertions: a fresh supported input is consumed before model turn; no model call is started; clear failure is emitted; no unexpected retry or subsequent admission. Exercise input event precedence with other installed handlers. **Direct `session.agent.prompt()` is an explicit lower-level SDK bypass outside the extension's admission guarantee**; document and test as a negative demonstration, not as a passing protected entry point.

### 9.3 A2: tools, continuations and batches (G1)

Test with gate red initially and after a green admission:

- Direct `bash` forcibly re-exposed via settings/CLI; tool call denied before execution.
- Built-in and custom tools under deny policy; unauthorized file/network/process side effects do not occur.
- Nested tool calls via policy-aware dispatcher vs deliberate `.execute()` bypass attempt.
- `agent.continue()` and automatic retries/compaction/steering after gate goes red; every resulting tool call is blocked.
- Mixed authorized/blocked tool batches; independently prove **per-call blocking** even if `terminate:true` does not end the batch. Test the pinned semantics that termination occurs only when every finalized result requests it.
- Cross-package model tool and direct extension-internal `execFile`; first should obey policy, second must be evaluated at the OS isolation boundary.

**Pass:** zero unauthorized tool side effects in every supported test, with deterministic denial metadata. This test does **not** prove a no-tool continuation stopped provider activity.

### 9.4 A3: in-flight provider cancellation (G3, conditional)

With a controlled mock provider, start a long/streaming request, turn gate red during it, then invoke the supported active-operation abort path. Assert and record:

1. abort reached the active operation;
2. no additional tool execution occurred;
3. no new provider request started after red gate;
4. whether the local stream stopped, and when;
5. whether bytes had already reached the provider (do not claim reversal);
6. whether caller obtained a clear `stopped`, `failed`, or `uncertain` result.

Include retries, queueing, and provider errors. Distinguish **preventing new calls** from **canceling a request that already started**. Since the pinned `before_provider_request` contract does not document a blocking return, do not rely on a pre-request block from that hook.

**Release rule:** G3 may be labeled verified only when the tested runtime/provider combinations demonstrate the specified cancellation semantics. Otherwise report G3 as limited/unknown while retaining G1/G2 claims if passed.

### 9.5 A4 and A5: explicit boundary tests

- **A4:** Demonstrate that lower-level direct SDK agent-driving paths can bypass the session `input` hook. Treat untrusted SDK embedders and an unloaded package as requiring a launcher/host-level boundary; they are outside v1 in-extension guarantees.
- **A5:** Demonstrate that tool-only sandboxing does not constrain arbitrary extension-internal Node process execution, whereas correctly configured whole-process containment blocks forbidden host effects. Use disposable test files, not real home-directory data.

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

Use same pinned model, repository snapshot, hardware, and test fixtures where possible; repeat enough runs to assess variance. Optimizations are accepted only when repeatably beneficial without breaking correctness or permissions.

### 9.7 Adversarial suite

Must include direct destructive shell request, alternative deletion path, interpreted agent-written script, package-script execution, path traversal/symlink race, prompt injection through repository files, secret reads/exfiltration, nested call bypass, unauthorized profile elevation, cache cross-scope leakage, malicious companion tool, and direct extension-internal `execFile`. Record concrete blocked/contained outcomes, not just presence of hooks.

## 10. Acceptance traceability

| Product acceptance | Technical evidence |
|---|---|
| AC1 activation | package/settings/trust integration tests; solo and project |
| AC2 tool removal | `pi.getActiveTools()` snapshots under configured scope |
| AC3 interception | re-exposed bash denied before side effects |
| AC4 startup R2a | A1 G2 + A2 G1; known missing-package limit documented |
| AC5 runtime R2b | adversarial and composition suite |
| AC6 coverage | representative tasks, `CAPABILITY_GAP` and in-turn errors |
| AC7 restricted permissions | write/process denied across direct and nested tools |
| AC8 isolation | forbidden paths/credentials inaccessible in chosen sandbox |
| AC9 semantic correctness | differential fixtures |
| AC10 performance | paired task-level benchmark report |
| AC11 diagnostics | `/nobash-status` shows distinct verified/unknown states |
| AC12 deactivation | both-control removal, partial-state verification |
| AC13 headless/peers | independently gated SDK/headless instances |
| AC14 mid-session | red-state transition, retry/continuation/cancellation tests |
| AC15 escalation | config-gated escape hatch; self-elevation denied |
| AC16 cross-package | tool-call policy and process containment tested separately |

## 11. Ordered implementation plan

**Phase 0 — feasibility harness (release blocker):** Pin `6fb2e78`; inspect APIs; build a minimal extension/mock runner; execute A1 and A2 including continuation and batching; exercise A3 independently; verify loader/trust/settings chronology. Do not claim G1/G2 until passed.

**Phase 1 — package and diagnostics:** Build package manifest; settings examples; red-by-default hooks and verified gate; `/nobash-status`; compatibility check; interactive/team/headless activation and deactivation tests. Keep missing-component limitation explicit.

**Phase 2 — core engineering replacements:** Reuse Pi built-in reads/search/edits; implement `query_jsonl` first (highest measured legacy usage for inline JSON), then typed Git and named validation, then smaller general capabilities as demand requires. Add policy-aware nested calls and common constrained execution.

**Phase 3 — safety boundary:** Enforce profile, paths, arguments, environment and return scope; enable reproducible isolated execution; test whole-process isolation including independent extensions; permit escape hatch only under trusted configuration and verified isolation.

**Phase 4 — coverage and optimization:** Replay representative previously bash-enabled tasks; instrument unmet intent; run differential/adversarial suites; benchmark backend selection and end-to-end task metrics; document explicit performance tradeoffs.

**Phase 5 — release gate:** Produce evidence bundle linking version, config, test results, coverage, isolation mode, and limitations. Only advertise verified protection levels. No self-certified green status in place of executed tests.

## 12. Open decisions and blockers

| ID | Open item | Why it matters | Resolution artifact |
|---|---|---|---|
| **Q1** | Does red-gate `input` cover every supported fresh entry with other extensions loaded? | G2 completeness | A1 trace and tests |
| **Q2** | Does `tool_call` interception cover continuation batches and nested calls with correct `terminate` semantics? | G1 completeness | A2 tests |
| **Q3** | Can `ctx.abort()` actually stop local provider activity promptly and report outcome? | conditional G3 | A3 mock-provider tests |
| **Q4** | What loader/order behavior applies to trust, settings, hook registration and first input in every mode? | startup race/fail-closed | startup integration trace |
| **Q5** | What exact 1.1.0 version/SDK/package compatibility and peer-dependency checks are valid? | reproducible installation | pinned source/manifest inspection |
| **Q6** | Which whole-Pi-process isolation profiles work per target OS? | S10b cross-package containment | platform proof/tests |
| **Q7** | Who controls escape-hatch configuration for interactive and headless use? | no self-elevation | trusted config contract |
| **Q8** | Which effective settings/package changes can be detected during live sessions? | stale policy state | runtime change tests |
| **Q9** | Which Pi/SDK event/result best surfaces a same-turn capability gap? | reliable caller feedback | interactive and headless tests |
| **Q10** | Should a future launcher verify package presence before Pi starts? | unloaded-extension hole | future product decision; out of v1 |
| **Q11** | What coverage/performance numbers constitute release readiness? | measurable acceptance | baseline and benchmark report |

## 13. Release security claims

Allowed **only after corresponding runtime evidence**:

- **“Bash is removed from the model-facing toolset”** when effective tool inspection verifies absence.
- **“Unauthorized tool execution is blocked”** when G1/A2 passes for supported Pi tool-call paths.
- **“New supported session turns are refused under a failed gate”** when G2/A1 passes.
- **“Provider activity cancellation is verified”** only for tested G3/A3 runtime/provider cases, with honest uncertainty and no suggestion of unsending requests.
- **“Extension-internal execution is contained”** only when whole-process OS isolation was actually verified for the stated environment.

Never claim automatic enforcement when the package fails to load or when an SDK embedder bypasses the session-level APIs; these require a separate host/launcher trust boundary.

**Final engineering rule:** The model chooses a typed operation; trusted runtime code chooses a bounded, authorized implementation. The extension must prevent unsupported work through verified hooks and policy, and the OS boundary must constrain executable behavior that those hooks cannot observe.

## 14. Primary implementation references

- Pinned Pi source: `https://github.com/earendil-works/pi/tree/6fb2e78`
- Coding-agent extension docs: `https://github.com/earendil-works/pi/blob/6fb2e78/packages/coding-agent/docs/extensions.md`
- Coding-agent SDK docs: `https://github.com/earendil-works/pi/blob/6fb2e78/packages/coding-agent/docs/sdk.md`
- Package docs: `https://github.com/earendil-works/pi/blob/6fb2e78/packages/coding-agent/docs/packages.md`
- Settings docs: `https://github.com/earendil-works/pi/blob/6fb2e78/packages/coding-agent/docs/settings.md`
- Agent session source: `https://github.com/earendil-works/pi/blob/6fb2e78/packages/coding-agent/src/core/agent-session.ts`
- Pi security docs: `https://github.com/earendil-works/pi/blob/6fb2e78/packages/coding-agent/docs/security.md`
- Adversarial inspiration: `https://github.com/disler/bash-damage-from-within`

These are source locations to verify against the pinned checkout. **No live Pi runtime tests, provider-cancellation tests, or sandbox escape tests were run while drafting this document.**
