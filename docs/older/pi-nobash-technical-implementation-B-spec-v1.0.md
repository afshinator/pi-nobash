# pi-nobash — Technical Implementation Specification v1.0

**Status:** Implementation baseline. Mechanisms are source-supported at the pinned Pi version; guarantees become operational only when their verification targets pass.
**Date:** 2026-10-08
**Product:** `pi-nobash`
**Companion document:** pi-nobash — Product Specification v1.3 (product requirements, acceptance criteria AC1–AC16, open questions Q1–Q10).

This spec says *how* to build what the product spec requires. Where the two disagree, the product spec governs intent and this spec governs mechanism.

---

## 0. Source pin and governing rule

### 0.1 Pinned reference

All API signatures, event contracts, and loader behavior in this document were read from:

- Repository: `github.com/earendil-works/pi`
- Commit: `6fb2e7815167e6b19006fc526d1a5d0f5f998787` (`6fb2e78`)
- Package: `@earendil-works/pi-coding-agent@1.1.0`

Every mechanism below cites the file and symbol a reader can open at that commit to re-verify it. Implementation targets this pin. A different Pi version must be re-verified against this document's claims before the guarantees are asserted.

### 0.2 Governing rule: source-supported is not enforcement-verified

Source inspection establishes the *intended mechanism* for a guarantee. It does not establish *operational coverage*. A guarantee may be described as "implemented against the documented API, pending test"; it may be claimed as operational only after its verification target (Section 7) passes. This rule governs every claim in this document.

### 0.3 Compatibility floor

Minimum supported Pi: `@earendil-works/pi-coding-agent@0.84.2`, the release that fixed `defaultTools` dropping extension/SDK custom tools when selecting built-in defaults. The product requires both `-bash` removal and coexisting registered replacement tools; below this floor they do not coexist. Implementation pins to 1.1.0 (0.1) and declares a runtime floor of 0.84.2 verified at startup (Section 5).

---

## 1. Source findings (F1–F4)

These are the verified facts the R2a contract is built on. Each is a claim to re-verify at the pin, paired with its test in Section 7.

**F1. `before_agent_start` cannot cancel a turn.**
`BeforeAgentStartEventResult = { message?, systemPrompt? }` (`packages/coding-agent/src/core/extensions/types.ts`, interface at ~L1468). The result carries a `message` and an optional full-prompt replacement `systemPrompt`; it has no cancel field. The event object exposes a mutable `systemPromptOptions`, but that is event input, not a handler result. `before_agent_start` is therefore excluded as a cancellation mechanism.

**F2. `input` → `{action:"handled"}` is the only pre-agent cancel, and it short-circuits.**
`InputEventResult` includes `{ action: "handled" }` (types.ts, ~L1159). `_runInputHandlers` returns `undefined` when a handler returns `handled` (`packages/coding-agent/src/core/agent-session.ts`, ~L1928), which prevents the turn from entering the agent loop.

**F3. Every documented turn-start entry routes through `input`.**
`_runInputHandlers` is called from `session.prompt()` (agent-session.ts ~L1993) and from the steer/followUp path (~L2183). RPC mode drives turns via `session.prompt()` / `session.steer()` / `session.followUp()` (`packages/coding-agent/src/modes/rpc/rpc-mode.ts`, ~L399/417/422). Print mode drives via `session.prompt()` (`packages/coding-agent/src/modes/print-mode.ts`, ~L132/136). The SDK's documented turn entry is `session.prompt()` (`docs/sdk.md`). All route through the `input` event.

**F4. `ctx.shutdown()` is deferred/no-op; it is not a turn-stop primitive.**
Per `docs/extensions.md`, `ctx.shutdown()` requests orderly shutdown, deferred until idle in interactive mode and a no-op in print mode. It is secondary cleanup, not enforcement. Additionally, a `tool_call` handler failure blocks the tool as a fail-safe (`docs/extensions.md`, "Errors and cleanup"): a throwing guard fails closed at the tool layer.

Supporting loader fact (for S4a, Section 6): a failed/throwing extension factory is caught and collected into an errors array; startup continues without that extension (`packages/coding-agent/src/core/extensions/loader.ts`, `loadExtension` ~L643–657, `loadExtensionsInternal` ~L676–712). An unloaded enforcement component cannot fail closed.

---

## 2. The R2a enforcement contract

R2a is admission control and cancellation: does a new turn start, is an unauthorized tool refused, is an in-flight operation cancellable. It is distinct from R2b (Section 3).

### 2.1 Three-guarantee model

| ID | Guarantee | Mechanism (source-supported at pin) | Verification | Claimable |
|---|---|---|---|---|
| **G1** | No unauthorized tool execution | `tool_call` → `{ block: true, reason, terminate: true }` | A2 (incl. continuations and tool batches) | After A2 passes |
| **G2** | No new turn through supported entry points | `input` → `{ action: "handled" }` | A1 (across modes and entry paths) | After A1 passes |
| **G3** | No further provider activity after gate failure | `ctx.abort()` candidate; no pre-request block exists | A3 | **Not claimable at v1.0** |

Fail-closed is not one property. It is these three guarantees, claimed independently, each gated on its test.

### 2.2 G1 — tool-call guard

**Primary mechanism, per call.** When the enforcement gate is red, or a tool call is unauthorized for the active mode, the `tool_call` handler returns `{ block: true, reason }`. This refuses that call unconditionally. Per-call block is the load-bearing mechanism and must be correct on its own.

`ToolCallEventResult = { block?, reason?, terminate? }` (types.ts). To modify arguments, mutate `event.input` in place; blocking uses `block`.

**Additive, conditional.** The guard also sets `terminate: true`. Per source, early termination occurs **only when every finalized result in the current tool batch sets `terminate: true`**. Therefore:

- `terminate` is an optimization that may halt a batch early and reduce wasted turns.
- It is **not** a kill switch and must not be documented or relied on as one. A parallel batch in which any sibling resolves without the flag will not terminate early.
- The guarantee is delivered by per-call `block`, with `terminate` as best-effort batch halting.

**Fail-safe.** If the `tool_call` handler itself throws, Pi blocks the tool (F4). The guard is therefore fail-closed even on internal error; implementation must not swallow its own exceptions in a way that converts a throw into an allow.

**Coverage note for continuations.** `agent.continue()` paths (automatic retries, compaction retries, queued continuations) do not re-run `input` (G2's lever). They are covered by G1 whenever they invoke a tool, because `tool_call` fires per call regardless of how the turn began. A2 must exercise continuation turns to confirm this. A continuation that calls no tool is addressed by G3, not G1.

### 2.3 G2 — input guard

When the gate is red, the `input` handler returns `{ action: "handled" }`, which short-circuits before the agent loop (F2). This blocks a *new* turn on every documented entry path (F3). The handler must also emit the capability/enforcement result to the invoker in the same turn (Section 4.3), so a refusal is visible, not silent.

G2's scope is new turns through supported entry paths. It does not cover `agent.continue()` continuations (which bypass `input`) — those are G1's responsibility via `tool_call`. It does not cover a caller that drives `session.agent.prompt()` directly beneath the session API (Section 6.2, excluded).

### 2.4 G3 — provider-activity cancellation (not claimable at v1.0)

There is no source-confirmed pre-request block. `before_provider_request` has result type `unknown` (types.ts, ~L1422) with no documented block contract. The only in-flight cancel lever is `ctx.abort()` / `agent.abort()` (`AbortController`-based; agent-session.ts ~L1399, L2434–2442).

**G3 success is forward-only.** No cancellation API can un-send bytes already transmitted to a provider. A3 (Section 7) therefore verifies, after a red gate is detected mid-operation:

1. the active operation receives cancellation (`ctx.abort()` is invoked and propagates),
2. no subsequent tool execution occurs,
3. no new provider request begins,
4. the system reports cancellation as **succeeded or uncertain**.

A3 must **not** require proof that already-transmitted data was recalled; that is physically impossible and is explicitly out of scope.

**Release rule.** G3 does not gate G1/G2 implementation or release (Section 8). The product ships G1/G2 without G3 provided its protection claims explicitly exclude comprehensive provider cancellation. G3's absence is a stated limitation, written down, not silence.

### 2.5 Gate evaluation and the guard set

The enforcement gate (Section 5) produces a boolean "protected and verified" state plus a reason set. The guards read it:

- `input` handler: gate red → `{ action: "handled" }` + invoker-visible reason.
- `tool_call` handler: gate red OR call unauthorized for mode → `{ block: true, reason, terminate: true }`.
- On any mid-session transition to red (Section 5.4): the two guards above take effect for subsequent turns/calls; `ctx.abort()` is invoked against any active operation (G3 candidate, A3-gated).

Guards are registered in the extension factory so they are active before the first turn (Section 5.1). Handler order is extension load+registration order (`docs/extensions.md`); pi-nobash must register its guards without depending on another extension running first.

---

## 3. The R2b isolation boundary

R2b is coverage, capability composition, and actual containment: given admitted, authorized operations, can the aggregate still cause harm, and does isolation bound it. R2b and R2a fail independently and are tested independently. A green R2a says nothing about R2b.

### 3.1 Proven: per-tool sandboxing does not sandbox extension-internal Node

Verified at the pin:

- The sandbox example isolates by `SandboxManager.wrapWithSandbox(command)` then `spawn("bash", ["-c", wrappedCommand])` (`packages/coding-agent/examples/extensions/sandbox/index.ts`, ~L134–142). The boundary wraps the command a tool spawns.
- Gondolin "runs pi's built-in **tools** inside a local Gondolin micro-VM" (`examples/extensions/gondolin/index.ts` header); the routing extension runs on the host, outside the VM.
- `ExecutionEnv` is a tool-execution abstraction used by the durable worker (`packages/env`, `src/experimental/durable/*`); it is **not** exposed on `ExtensionAPI` (no `ExecutionEnv` symbol in `extensions/types.ts`). pi-env README: "an agent's **tools** run on another machine, while the Durable worker, its storage and credentials stay local."

**Conclusion.** An extension's own `child_process` call (e.g. `execFile("python", [...])`) never becomes a `tool_call`, never passes `wrapWithSandbox`, and has no `ExecutionEnv` interposed. The tool_call guard cannot see it. This is the S10b distinction, proven.

### 3.2 Containment design

- **S10a (tool-call policy):** every model-accessible tool, in any loaded package, is subject to the tool_call guard and per-tool authorization. This is hook-enforced.
- **S10b (process containment):** extension-internal execution is contained only by a whole-process OS/container/VM boundary supplied by the deployer. pi-nobash does not provide it and must not claim it. Whole-process isolation is a separate, explicitly verified protection level, not part of the in-extension guarantee.

### 3.3 Capability-composition requirements

The tool_call guard and per-tool implementations must jointly prevent the aggregate bypasses in the product spec S5:

- No tool accepts an unrestricted shell/command string (no `command`/`script`/shell-expression parameter in any typed tool).
- No typed tool pins an interpreter against an agent-chosen file (e.g. `restricted_exec({program:"python", args:[agentFile]})` is disallowed; `run_validation` runs harness-owned configured commands only).
- Structured tools spawn with `shell: false` and operation-specific argv, using `--` where applicable and explicit flag allowlists.
- Nested tool execution uses Pi's policy-aware path (`ctx.executeTool()`), never a tool's `.execute()` directly, so interception is not bypassed.
- Return-data scope is minimized (names/metadata/counts over raw contents) to limit disclosure and prompt-injection surface.

These are necessary for R2b coverage but do not substitute for S10b isolation: a configured `run_validation` command can still execute repository-controlled code, which only OS isolation bounds.

---

## 4. Tool surface and substitutions

### 4.1 Selection model

The model chooses tools by description; Pi does not route. Implementation quality rests on: (a) tool descriptions and typed schemas, (b) the agent-guidance skill's intent→tool map, (c) absence of bash removing the fallback. Each registered tool must carry a clear name, a task-oriented description, a typed parameter schema, output bounds, and failure semantics (product spec 5.3).

### 4.2 Substitution map

Built-in Pi primitives (no new code): `read`, `grep` (with `literal: true` for fixed strings → ripgrep `--fixed-strings`), `find`, `ls`, `edit`, `write`.

New typed tools (this package): `query_jsonl`/`json_query` (streaming, typed filters/projection/aggregation, bounded output), `git` (typed operation + argv, `shell:false`), `run_validation` (named configured checks only, timeout/cancellation/bounded output), `check_model`, filesystem-lifecycle `delete` (workspace-scoped), and `restricted_exec` (escape hatch; enumerated program allowlist, argv array, `shell:false`, filtered env, cwd policy, time/output limits, audit).

Codemode: bounded one-off glue; not the bulk-data engine.

Companion-package tools (e.g. `fallow`, `herdr`): ship separately, not in pi-nobash; bound by S10a tool-call policy; extension-internal execution bound only by S10b.

### 4.3 In-turn gap and denial reporting

On an unmet legitimate intent, the agent records a `CAPABILITY_GAP` event **and** returns an explicit result to the turn's invoker in the same turn naming the unmet operation: user-visible message interactively; equivalent structured failure to the caller in SDK/headless. A blocked tool returns a structured failure with its reason (G1). Telemetry alone does not satisfy in-turn reporting. The mechanism for distinguishing a gap/denial result from a normal answer (reply text vs structured event) is an implementation detail each mode must define (product spec Q9).

---

## 5. Startup gate and activation

### 5.1 Activation order (verified at pin)

1. Personal + CLI extensions load; these may participate in `project_trust` (`docs/extensions.md` ~L50).
2. Project trust resolves. Project `.pi/settings.json` is read **only after trust is granted**; project packages install/load **only after trust is resolved** (`docs/packages.md` ~L19/21). Untrusted → project pi-nobash never loads (S4a applies).
3. Project package factory runs. pi-nobash registers tools (`pi.registerTool`) and guards (`pi.on("input"...)`, `pi.on("tool_call"...)`). Async factory completes before startup continues (`docs/extensions.md` ~L56). Do not start long-lived resources in the factory; use `session_start`.
4. `session_start` fires.
5. `defaultTools` resolves the active set: `-bash` removes the built-in; `+name` adds; extension tools registered inactive are activated by selection or `setActiveTools()` (`docs/settings.md` ~L40/44). With the 0.84.2 fix, `-bash` and registered replacement tools coexist.
6. Per turn: `input` → `before_agent_start` → model → tool events. Guards act at `input` (G2) and `tool_call` (G1).

### 5.2 Gate checks (F14 / R2a presence)

Before the first protected turn, the gate establishes, and records reasons for any failure:

- running Pi version ≥ 0.84.2 and required APIs present;
- `bash` absent from the effective active set, read via `pi.getActiveTools()` (`docs/extensions.md` ~L164);
- pi-nobash `input` and `tool_call` guards registered and active (positive attestation, not mere handler definition — product spec Q3; use a controlled canary if attestation is insufficient);
- expected replacement tools and mode/policy configuration present;
- mode/isolation prerequisites for the requested operating mode satisfiable.

A failed or unknown required condition sets the gate red. A red gate makes G1/G2 guards refuse (Section 2.5). The gate verifies enforcement **presence** (R2a), never runtime containment (R2b).

### 5.3 `getActiveTools()` scope

`pi.getActiveTools()` confirms what is **presented** to the model, not that every execution path is blocked (product spec distinction). Use it for the bash-exposure check (AC2) and `/nobash-status` exposure reporting (AC11). It is not evidence of containment.

### 5.4 Mid-session (S2a / Q8)

Activation/deactivation and policy changes require restart for supported transition. The gate records the last verified state. If a required condition becomes known-invalid during a protected session, subsequent protected turns block (G1/G2 guards read red) and any active operation receives `ctx.abort()` (G3 candidate, A3-gated). Detection of all external file/package changes is not assumed (Q8); the design does not rely on unverified hot-reload.

### 5.5 `/nobash-status`

Registers the diagnostic command (name `/nobash-status`). Reports, with unknown/unverified never shown as passing: profile scope and Pi compatibility; effective bash exposure via `getActiveTools()`; gate pass/fail/unknown with failed checks and last-evaluation time/phase; profile state (active/inactive/partial/failed/unknown; drift is not a clean pass); operating mode and available capabilities; configured isolation mode and whether verified; last adversarial-coverage evidence (R2b), separately labeled; and, for G3, whether the last cancellation was reported succeeded or uncertain. When the package is removed the command is unavailable and cannot diagnose that state.

---

## 6. Scope exclusions (A4) and the unloaded-component gap

These are deliberate boundaries of the in-extension guarantee, written down, not defects.

### 6.1 Unloaded enforcement component (S4a)

If the pi-nobash package is absent, disabled, untrusted, or fails to load, no guard runs, no gate executes, and nothing refuses the session — even if a stale `-bash` remains. Confirmed in the loader (F4 supporting fact): load failures are caught and startup continues. A component that is not loaded cannot fail closed. Guaranteeing that a project *claiming* the profile refuses when the component is missing requires a host-level/launcher check outside the Pi extension (Q10), out of scope for v1.0. This limitation must be documented, not implied-covered by the gate.

### 6.2 Direct lower-level SDK driving

An SDK embedder can invoke `session.agent.prompt()` beneath the session API, bypassing `input` (G2). The SDK documents `session.prompt()` as the entry; nothing prevents direct agent driving. This cannot be closed inside the extension and is excluded from the in-extension guarantee. For untrusted embedders, use the whole-process boundary (Section 3.2 / A5).

### 6.3 Extension-internal execution

Per S10b / Section 3.1, extension-internal Node execution is outside tool_call interception and is contained only by whole-process isolation (A5). Excluded from the in-extension guarantee.

---

## 7. Verification targets (A1–A5)

Guarantees are claimable only when their targets pass (0.2). Tests run on a real Pi runtime at the pin (0.1) and on the declared floor (0.3).

**A1 — G2 entry-path coverage.** Matrix: modes {interactive, print, RPC, SDK `session.prompt`} × entry paths {normal prompt, steer, followUp}. Assert: under a red gate, no new turn enters the agent loop on any cell. This is the central R2a test; the failure mode is a turn that reaches the agent without firing `input`.

**A2 — G1 continuation and batch coverage.** Assert: under a red gate, no tool executes, including (a) tool calls on `agent.continue()` continuation turns, and (b) each call in a parallel tool batch (per-call `block` holds regardless of `terminate` batch conditions). Verify the throwing-guard fail-safe (a guard exception blocks the tool, not allows it).

**A3 — G3 provider cancellation (forward-only).** After detecting a red gate during an active operation, assert: (1) the active operation receives cancellation; (2) no subsequent tool executes; (3) no new provider request begins; (4) the system reports cancellation as succeeded or uncertain. Do **not** assert recall of transmitted data. Until A3 passes, G3 is not claimed and provider cancellation is excluded from protection claims.

**A4 — scope exclusions.** Assert the product documents and does not claim protection for: unloaded/absent component (6.1), direct lower-level SDK driving (6.2), extension-internal execution (6.3). This is a documentation/claims test, not a containment test.

**A5 — whole-process isolation (separate level).** Under a configured OS/container/VM boundary, assert extension-internal and tool-spawned execution cannot reach prohibited host paths/secrets beyond containment. This verifies the separate isolation level, not the in-extension guarantee. Required before any "protected execution"/containment claim.

**R2b adversarial suite.** Independently of A1–A3, run the capability-composition suite (product spec S5/S6): direct bash and alternate process tools; agent-authored script + interpreter; nested `.execute()` bypass; extension-internal execution (expected contained only under A5); repo-controlled npm/build/test/lint hooks via `run_validation`; path traversal/symlink/out-of-workspace; prompt injection via repo content. Re-run on any tool/allowlist/backend/policy/isolation change. Green A1/A2 does not imply R2b coverage.

---

## 8. Release rule

v1.0 may claim, each after its test:

- **G1** (no unauthorized tool execution) — after A2.
- **G2** (no new turns through supported entry points) — after A1.

v1.0 **must not** claim, and must explicitly exclude:

- **G3** (comprehensive provider-activity suppression) — until A3; provider cancellation is excluded from protection claims in its absence.
- **Containment of extension-internal or untrusted executable code** — until A5 under a configured isolation boundary.
- **Protection of unloaded-component or direct-SDK-driven sessions** — out of scope (6.1, 6.2).

G3's exclusion does not delay G1/G2 release. The product's protection statement reads, at v1.0: *"Once tested, pi-nobash refuses new turns through supported entry points and refuses unauthorized tool calls (including continuations and batches). It does not comprehensively suppress already-running provider activity, does not contain extension-internal or untrusted executable code without a configured whole-process isolation boundary, and does not protect sessions where its component is not loaded or where an embedder drives the agent beneath the session API."*

---

## 9. Build order

1. Package scaffold + manifest (`pi` key: extensions, skills), pinned deps as peerDependencies `*`, floor ≥ 0.84.2 (Section 0.3), `/nobash-status`, startup gate (Section 5), `input`+`tool_call` guards (Section 2). Settings carry `defaultTools` with `-bash` (separate from manifest).
2. Direct-primitive guidance skill + restricted mode.
3. `query_jsonl` first (largest observed bash category), then typed `git`, `run_validation`; `check_model`, lifecycle `delete`, `restricted_exec` on demand.
4. Central policy + telemetry (O1–O4), in-turn gap/denial reporting (4.3).
5. Verification: A1, A2 first (gate G1/G2 release); A3 (gate G3 claim); A5 + R2b suite (gate containment claim).
6. Companion-package pattern documented; cross-package policy test (AC16).

A release cannot claim protected operation beyond G1/G2 until the corresponding targets pass at the applicable scope.
