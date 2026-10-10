# pi-nobash — Product Specification v1.4

**Status:** Proposed product baseline; implementation feasibility items explicitly open
**Date:** 2026-10-09
**Product:** `pi-nobash`
**Purpose:** Remove model-facing `bash` from Pi coding agents so a well-intentioned model cannot execute a hallucinated destructive command, and replace it with specific typed tools that keep real engineering work possible.

## 1. Product definition

`pi-nobash` is an opt-in Pi package plus tool-selection profile. It removes built-in `bash` from the agent-facing toolset, blocks any attempted bash call as a backstop, and supplies purpose-built tools for the workflows that previously went through shell. It does **not** remove all process execution: building, testing, version control, and validation still work through typed capabilities.

### 1.1 Why this exists

A capable model acting in good faith can still hallucinate a command. With bash available, one bad string (`rm -rf`, a wrong `mv`, `git reset --hard` on the wrong ref) executes and destroys work. The fix is to take the loaded gun off the table: bash is not present, so the model cannot reach for it by reflex or by mistake. The agent still does engineering work through tools whose blast radius is bounded by their shape.

This is accident prevention, not an anti-attacker system. One constraint follows from that framing and must hold:

> **Removing bash must not make arbitrary execution easier to reach by another path.** Every substitute tool takes a typed operation and fixed arguments. None accepts a shell string, and none wraps an interpreter that runs agent-authored code. That is the single security line this product defends.

### 1.2 Goals

- **G1 — No routine raw bash.** Bash is absent from the model-facing toolset; an attempted call is independently blocked.
- **G2 — Preserve engineering capability.** Reading, searching, editing, git, validation, and JSON/JSONL analysis remain usable through supported operations.
- **G3 — Keep substitutes narrow.** No replacement tool accepts a shell string or runs an arbitrary interpreter, so bash removal does not reopen arbitrary execution under a new name.
- **G4 — Stay efficient.** Pick appropriate backends; minimize unnecessary reads, model turns, memory, and output tokens.
- **G5 — Make failures visible.** Surface capability gaps and denials explicitly in the turn, never a silent stall or a silent shell fallback.
- **G6 — Make adoption reversible.** Clear solo and team activation, a diagnostic command, and clean deactivation.

### 1.3 Non-goals

- Defending against a deliberate attacker trying to bypass the tool surface. The threat model is model error, not adversarial escape.
- Guaranteeing OS-level containment through this package. Isolation is a recommendation (Section 6.3), not something the package provides or gates on.
- Replacing all OS processes with pure JavaScript.
- Exposing unrestricted `python`, `node`, `jq`, generic script execution, or shell strings under new tool names.
- Building a universal query language, unrestricted SQL interface, or plugin marketplace.
- Protecting Pi sessions outside the settings scope where the profile is enabled.
- Promising speedups independent of workload measurement.

## 2. Users and environments

**Primary user:** a developer running Pi coding agents against a repository. **Team user:** a contributor who opens a trusted repository carrying the project's Pi settings. **Package maintainer:** builds, tests, publishes, and updates the package.

The product supports interactive Pi sessions and SDK/headless agents when their runtime exposes the needed tool-selection interfaces. Each agent instance gets the profile from its own settings; a separately launched agent is configured independently and is not protected by another session's profile.

## 3. Activation, daily use, and deactivation

### 3.1 Distribution model

The **package** carries the replacement tools, the backstop hook, and agent guidance. **Pi settings** (separate from the package manifest) select the package and remove bash through `defaultTools`. Installing the package alone does not remove bash; the settings entry does. Both are required, and the product must not describe install-only as a working profile.

Package name: `pi-nobash`. Diagnostic command: `/nobash-status`.

Project-specific or personal utilities that are not part of the general bash-substitution surface ship as a separate companion package, not inside `pi-nobash`. A companion package's model-facing tools are still bound by the same tool-call policy. The split is organizational.

### 3.2 Package author flow

1. Build a versioned Pi package with the registered typed tools, the backstop hook, and operating-mode guidance.
2. Declare the supported Pi release baseline and required host-provided dependencies.
3. Publish via a pinned Git or npm reference with reproducible release tests.

### 3.3 Solo developer flow

1. Install the package in user-level Pi configuration.
2. Set user `defaultTools` to remove `bash` and expose the required built-ins and replacement tools.
3. Restart Pi. The startup check confirms bash is absent and the hook is active before protected work begins. Profile changes during a live session require a restart.
4. Optionally run `/nobash-status` to inspect the active toolset and enforcement.

**Acceptance:** A user cannot mistake package-installed-without-settings for an enabled profile.

### 3.4 Team/project flow

1. A maintainer commits a project `.pi/settings.json` with both a pinned `packages` entry for `pi-nobash` and a `defaultTools` selection that removes `bash`.
2. A contributor pulls the project, starts Pi from it, and approves the project trust prompt where applicable.
3. Pi loads the package and tool selection; the startup check establishes whether the profile is active.
4. The contributor works normally, with no extra per-person setup when the supported Pi version and trust settings make project activation work.

Protection applies to Pi instances where this project profile is effective, not to all machine-wide sessions.

### 3.5 Daily use

The user describes work in natural language. The agent uses Pi's `read`, `grep`, `find`, `ls`, `edit`, `write` where they fit; uses typed tools for git, validation, and JSON/JSONL querying; and uses the escape hatch only where no typed capability exists. An unsupported request produces an explicit capability-gap result in the same turn, never a silent stall or a silent fallback.

### 3.6 Deactivation

To disable `pi-nobash`, remove **both** the package configuration and the `-bash` tool-selection entry, then restart and verify. Removing only the package can leave bash hidden; removing only `-bash` can leave the hook active. While the package is still present, `/nobash-status` reports a detected partial configuration rather than a clean "off." Once the package is removed its command no longer exists; verify complete removal through Pi configuration. Team-wide deactivation requires committing the project settings change.

## 4. Modes and permissions

| Mode | Target role | Normal capabilities | Process escape hatch |
|---|---|---|---|
| **Restricted** | Reviewers, analysts, planning peers | Read, search, bounded structured queries; optional codemode | Not available |
| **Engineering (default)** | Coding/editing agents | Restricted plus authorized edits, typed git, named validation | Not available by default |
| **Escape-hatch** | Explicitly authorized debug/migration agents | Engineering plus controlled `restricted_exec` | Audited, allowlisted |

Permissions apply per agent/session. The tool surface for a mode comes from its settings, not from prompt wording alone; a prompt telling an agent to behave as read-only is not enforcement, the tool selection is.

**Escape-hatch authorization:** Escape-hatch mode must be enabled by a user or trusted project administrator through configuration. An agent may report a gap or request an authorized operation, but must not enable the mode, change its own permissions, or approve its own elevation. This matters for accident prevention: a model that could grant itself execution would defeat the removal. Authorization mechanics for interactive vs headless workflows remain open (Q4 below).

## 5. Functional tool requirements

### 5.1 Existing Pi primitives

| Requirement | Expected operation |
|---|---|
| **F1. Fixed-string search** | Pi `grep` with `literal: true` when regex is unnecessary |
| **F2. Regex search** | Regex mode only when needed |
| **F3. Discovery/listing** | `find` and `ls` with correct path/ignore semantics |
| **F4. Targeted reading** | Bounded `read` of a known file/range instead of wide scans |
| **F5. Editing** | Authorized `edit`/`write`; enforce workspace/write permissions |

Do not route these through a generic dispatcher when direct Pi invocation is simpler and at least as fast.

### 5.2 Structured capabilities

| Requirement | Capability | Minimum behavior |
|---|---|---|
| **F6. JSON/JSONL analysis** | `query_jsonl` / `json_query` | Typed filter, select/project, count/group/aggregate; bounded results; streaming for large JSONL |
| **F7. Git** | Typed `git` operations | status/diff/log/show; explicit authorized add/commit; scoped branch operations |
| **F8. Validation** | `run_validation` | Named configured checks (tests, lint, typecheck) with timeout, cancellation, bounded output |
| **F9. Provider/model checks** | `check_model` | Resolve/check approved model ids; bounded probe when permitted |
| **F10. Optional specialized tools** | Narrow tools where needed | Rendering/conversion and lifecycle through explicit operations. User-specific utilities (e.g. `fallow`, `herdr`) are optional and belong in a companion package |
| **F11. Filesystem lifecycle** | Safe delete/move/copy | Workspace-constrained, explicit targets, stricter controls for destructive effects |
| **F12. Escape hatch** | `restricted_exec` | Explicit program + argv; no shell string; requires authorization and audit |
| **F13. Light glue** | Codemode where enabled | Bounded one-off transforms and composition of permitted operations; not the bulk-data engine |

Tool names are product-level identifiers; the implementation spec locks actual registration names and schemas. **No tool accepts an unrestricted shell-command string in place of its typed contract.** This is G3 restated as a hard requirement on every tool.

### 5.3 Semantic-operation contract

Each operation states its meaning, typed input, permitted scope, effect class (read/write/process/network), output bounds, result/error semantics, and contract version. Unknown fields, invalid paths, unsupported operations, and exceeded budgets fail clearly. The runtime, not the model, chooses implementation details (native parse vs streaming vs index, git argv, the configured validation command). A backend change must preserve observable semantics and permissions.

### 5.4 Enforcement and diagnostics

**F14. Startup check.** Before protected agent work, `pi-nobash` verifies two things: `bash` is absent from the effective model-facing toolset, and the backstop hook is registered and active. If either cannot be established, protected work must not proceed silently, and the reason must be surfaced. This is a single presence check, not a layered proof of universal containment.

**F15. `/nobash-status` command.** Reports effective bash exposure, hook status, compatibility, operating mode, available replacements, and the last startup-check result. An unverified condition must not display as passing. When the package is removed, the command is unavailable.

### 5.5 Coverage and unsupported intent

The initial coverage corpus is the bash workload observed in existing usage: Python JSON/JSONL manipulation, grep/ripgrep, file reads, tests/typechecks, git, Pi probes, listings, filesystem operations, and small project tooling. Each category must have a tested replacement or an explicitly constrained exception.

The system records a `CAPABILITY_GAP` event for unmet legitimate intent, not just counts of denied bash calls (a model that no longer sees bash may never attempt one, so zero denials is not a coverage metric). Beyond logging, the agent returns an explicit result in the same turn naming the unmet operation: a user-visible message interactively, or an equivalent structured failure to the caller in SDK/headless sessions. The gap must not be telemetry-only, and the agent must not stall silently or substitute an unrelated workaround.

## 6. Security requirements

The product defends one line: bash removal must not reopen arbitrary execution. Two mechanisms carry that, plus an out-of-scope isolation recommendation.

### 6.1 Mechanism 1 — capability design (primary)

Do not expose a general shell or interpreter when a narrow operation meets the need. The model-facing surface is read/search/edit built-ins plus the typed tools in Section 5. Every tool takes a typed operation and fixed arguments. No tool takes a shell string, and no tool pins an interpreter that runs agent-authored code (`python <file>`, `node <file>`, `sh -c ...`, and equivalents). Prefer a named entrypoint the harness owns (`run_validation({check:"unit"})`) over a tool that would let the model choose an arbitrary program to run.

This is the whole prevention story: if the dangerous primitive is not present, a hallucination cannot invoke it.

### 6.2 Mechanism 2 — backstop hook

A `tool_call` hook returns `{ block: true, reason }` for any attempted `bash` call, covering any path that reintroduces the built-in (an override, a stale setting). It is defense in depth behind tool removal, not the primary control. Default-deny unsupported operations; a nominally read-only tool cannot mutate state.

### 6.3 OS isolation — recommended, out of scope for the package

A typed tool can still invoke repository-controlled code: `run_validation("unit")` may run `npm test`, whose script can do anything the process can. Bounding that is the job of an OS/container/VM boundary below the agent, so the recoverable failure is damage to a disposable checkout rather than the home directory.

This is a real risk and a real mitigation, but it is **not** what `pi-nobash` provides and **not** a release gate for this package. The package removes the model's reflexive shell access. Running execution-capable agents inside isolation is a deployment recommendation the product documents, not a feature it ships or verifies. Teams that need that boundary configure it through Pi's execution-environment/sandbox options separately.

### 6.4 Loading and trust notes

- **S1. Component must load.** The startup check and the hook only run when `pi-nobash`'s component is actually loaded. If the package is absent, disabled, or fails to load, no `pi-nobash` code runs and nothing refuses the session, even if a stale `-bash` setting remains. For v1 this is an accepted scope limit: the package protects only sessions in which it loads. Guaranteeing that a project *claiming* the profile refuses to run when the component is missing would need a host-level launcher check outside the Pi extension; that is out of scope for v1. This must be stated in documentation, not implied away by the startup check.
- **S2. Install is a trust decision.** Installing a Pi package runs code with host privileges before any runtime tool policy applies. Pin package refs, review source, and use project trust gates. Package delivery is not containment.
- **S3. Companion/third-party tools.** Any model-accessible tool in any loaded package must follow the same tool-call policy; packaging a tool elsewhere must not create a model-facing bypass. Process launched *inside* another extension's own Node code never becomes a Pi `tool_call`, so the hook cannot see it; that execution is bounded only by the isolation boundary of 6.3, if one is configured. The product must not claim the hook intercepts extension-internal execution.

## 7. Status, errors, observability

### 7.1 `/nobash-status`

Reports: installation/profile scope and Pi compatibility; effective tool availability including whether `bash` is exposed; startup-check state (pass/fail/unknown with failed checks and hook status); profile state (active/inactive/partial/failed/unknown, with detected drift not shown as clean); current mode and available structured capabilities. Unknown or unverified values never display as passing. The command is diagnostic, not proof that every execution path is safe.

### 7.2 Errors and telemetry

**O1.** Structured failure classes: permission denied, unsupported capability, invalid request, workspace violation, timeout/cancellation, truncated output, execution failure, startup-check failure, backend incompatibility.

**O2.** Per meaningful operation, where supported: operation, backend, policy decision, agent/run id, elapsed time, input/output bytes, records scanned/returned, cache hit, exit/error class, truncation.

**O3.** Redact or omit secrets and unnecessary raw arguments. Return compact results and bounded diagnostics rather than dumping process output or sensitive data into model context.

**O4.** Unmet intents and denied calls are reported to the turn's invoker in the originating turn (user-visible interactively; structured failure to the caller when headless) and recorded for coverage analysis. Telemetry visibility alone does not satisfy in-turn reporting.

## 8. Performance requirements

**P1. End-to-end objective.** Optimize task completion, correctness, total elapsed time, model turns, tokens, and memory, not subprocess speed alone.

**P2. Appropriate implementations.** Prefer existing optimized Pi search/read tools. For large one-pass JSONL, stream with early filter/projection. For repeated queries over stable files, add caching/indexing only if measured savings exceed preparation/invalidation cost. Codemode is for modest one-off glue.

**P3. Output efficiency.** Structured queries and validations support bounded results, field projection, and explicit truncation metadata. A count/aggregate must not require returning all source records.

**P4. Reproducible benchmarks.** Compare baseline bash-enabled and new-tool implementations on equivalent tasks, repo snapshots, hardware, model settings, and outputs; measure repeated runs, median and tail latency, token cost, peak memory where available, success rate, correctness.

**P5. No semantic degradation for speed.** An alternative backend must not silently alter ordering, matching, case/null/numeric behavior, path policy, or authorization. Correctness outranks superficial acceleration.

**P6. Optimization acceptance.** Promote a backend optimization only when it preserves correctness and permissions and gives repeatable benefit on representative workloads. No numeric targets are asserted before baselines are measured.

## 9. Acceptance criteria

| ID | Gate | Demonstration |
|---|---|---|
| **AC1** | Activation | Solo and trusted-project flows install/activate the right settings and package resources on supported Pi versions |
| **AC2** | Tool removal | `pi.getActiveTools()` shows built-in `bash` absent under the normal profile |
| **AC3** | Backstop | A deliberately re-exposed bash call is blocked before executing |
| **AC4** | Startup check | When the component loads, an inactive hook, incompatible Pi, or ineffective settings cannot result in a silently unprotected claimed-protected session. The unloaded-component case (S1) is documented scope, not covered by the check |
| **AC5** | No shell-string substitute | No replacement tool accepts a shell-command string or pins an arbitrary interpreter; each takes a typed operation + fixed argv (G3/6.1 verified per tool) |
| **AC6** | Engineering coverage | Representative read/search/edit/JSONL/git/validation tasks complete without bash; gaps are recorded and reported in the originating turn |
| **AC7** | Read-only permissions | Restricted roles cannot mutate files or run general processes through permitted tools |
| **AC8** | Semantic correctness | Differential fixtures pass for supported operations/backends, including malformed input and boundary cases |
| **AC9** | Performance | Paired benchmark report shows end-to-end impact; material regressions are identified and accepted or fixed |
| **AC10** | Diagnostics | `/nobash-status` uses `pi.getActiveTools()` for exposure status and distinguishes hook presence, partial/failed state, and last startup-check result |
| **AC11** | Deactivation | Full package/settings removal plus restart restores normal behavior; detected partial deactivation is reported, never labeled fully off |
| **AC12** | Headless/peers | Every separately launched agent claiming the profile passes its own startup check and role/permission checks |

Intentional safety refusals are not capability failures. A task that cannot be expressed by supported operations produces a clear gap rather than being marked complete. OS isolation (6.3) is a deployment recommendation and is not an acceptance gate for this package.

## 10. Release scope and order

**Foundation:** packaging/settings integration; direct Pi primitives; bash removal plus backstop hook; startup check; `/nobash-status`; restricted mode; telemetry for denials/capability gaps and in-turn gap reporting.

**Engineering capability:** streaming JSONL query, typed git, named validation, bounded `restricted_exec`; then additional typed utilities on observed demand.

**Verification:** differential functional tests, per-tool check that no substitute accepts a shell string, solo/team/headless activation tests, benchmark comparison, documented handling of unmet intents.

These are product milestones, not an SDK implementation sequence.

## 11. Open implementation questions

Not grounds to weaken the protection claim; inputs to the implementation spec.

- **Q1 — Effective activation:** Precisely when do project settings, package auto-install, trust approval, hook registration, and tool selection take effect, and in what order, for interactive and SDK/headless paths?
- **Q2 — Version contract:** What runtime compatibility check and host-provided `@earendil-works/*` peer-dependency declarations does the targeted Pi release require? Pi 0.84.2 fixed `defaultTools` dropping extension/SDK custom tools when selecting built-in defaults, so the floor is ≥ 0.84.2; verify the floor and that `-bash` removal and registered replacement tools coexist.
- **Q3 — Startup-check failure behavior:** Which supported Pi behavior lets the package refuse protected work when the check is red (reject the first turn, block tools, explicit refusal)? Verify before committing a design.
- **Q4 — Escape-hatch policy:** Who authorizes `restricted_exec` in interactive vs headless workflows, and which operations are initially permitted?
- **Q5 — Success thresholds:** What task-coverage and performance targets are justified by representative baseline runs?
- **Q6 — In-turn gap surfacing:** By what supported mechanism does the agent return a capability-gap result to the invoker in the originating turn (reply text, structured event, or both), distinguishable from a normal answer?
- **Q7 — Isolation (note, optional):** For teams that adopt the 6.3 recommendation, which Pi execution-environment/OS boundary meets their containment need per platform? Out of scope for the package; recorded for deployments that want it.

## 12. Final product rule

**`pi-nobash` may claim "bash removed" only when effective tool selection verifies it, and only for sessions in which its component is loaded (S1). Its protection is accident prevention: a well-intentioned model cannot reach shell, and no substitute tool reopens arbitrary execution (G3). It does not claim to contain a determined attacker or to isolate execution that never becomes a tool call; bounding repository-controlled code run by a legitimate validation is the job of an OS boundary (6.3), which this package recommends but does not provide.**
