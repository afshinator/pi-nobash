# pi-nobash — Product Specification v1.1

**Status:** Proposed product baseline; implementation feasibility items explicitly open  
**Date:** 2026-10-08  
**Product:** `pi-nobash`  
**Purpose:** Replace routine model-facing arbitrary shell access in Pi coding agents with safe, capable, performance-aware operations while preserving practical engineering workflows.

## 1. Product definition

`pi-nobash` is an opt-in Pi extension package and tool-selection profile. It removes built-in `bash` from the normal agent-facing toolset, blocks attempted bash execution as a backstop, and supplies purpose-built tools for workflows that otherwise depend on shell commands. It does **not** remove all process execution: building, testing, version control, and validation must still work through controlled capabilities.

The product must reduce the impact of accidental destructive commands and malicious instructions without turning coding agents into read-only assistants. It must optimize for correct, complete **agent tasks**, not merely faster individual subprocesses.

The central rule is **the agent requests a meaningful operation; trusted runtime code chooses and executes an authorized, efficient implementation.**

### 1.1 Goals

- **G1 — Prevent routine raw bash use.** Bash is absent from the model-facing normal toolset; attempted calls are independently blocked.
- **G2 — Preserve engineering capability.** Reading, searching, editing, git, validation, and structured-data analysis remain usable through supported operations.
- **G3 — Constrain damage.** Apply capability restrictions, enforced policy, and OS-level isolation for execution-capable workflows.
- **G4 — Improve efficiency.** Select appropriate backends and minimize unnecessary reads, model turns, memory consumption, and output tokens.
- **G5 — Make failures observable.** Surface capability gaps, policy denials, and verification failures explicitly rather than silently falling back to shell.
- **G6 — Make adoption reversible.** Support clear solo-developer and team activation, diagnostics, and deactivation.

### 1.2 Non-goals

- Guaranteeing universal containment solely through Pi hooks or prompt instructions.
- Replacing all operating-system processes with pure JavaScript.
- Exposing unrestricted `python`, `node`, `jq`, generic script execution, or arbitrary shell strings under new tool names.
- Building a universal programming language, unrestricted SQL interface, or broad plugin marketplace for the dispatcher.
- Automatically protecting Pi sessions outside the settings scope where the profile is enabled.
- Promising universal speedups independent of workload measurements.
- Providing a formal authorization system for every third-party Pi extension unless the configured isolation boundary explicitly covers it.

## 2. Users and operating environments

**Primary user:** a developer running Pi coding agents against a source repository. **Team user:** a contributor who opens a trusted repository with the project's Pi settings. **Package maintainer:** builds, tests, publishes, and updates the reusable extension package.

The product must support ordinary interactive Pi sessions and Pi SDK/headless agents *when their runtime exposes the necessary tool-selection and policy interfaces*. Independent agent instances must receive the intended policy. A protected supervisor session must not be assumed to protect independent peer processes automatically.

## 3. Activation, daily use, and deactivation

### 3.1 Distribution model

The **package** contains replacement tools, enforcement hook, and agent guidance. **Pi settings**, maintained separately from the package manifest, select the package and remove bash using `defaultTools`. Package installation alone must not be described as equivalent to model-facing bash removal.

The package name is `pi-nobash`. The diagnostic command name is **`/nobash-status`**, not `/doctor`.

### 3.2 Package author flow

1. Build a versioned Pi package containing registered semantic tools, policy hook, and operating-mode guidance.
2. Declare compatibility with the supported Pi release baseline and required host-provided dependencies.
3. Publish via a pinned Git or npm reference, with a reproducible release and verification tests.

### 3.3 Solo developer flow

1. Install the published package in the user-level Pi configuration.
2. Set the user's `defaultTools` to remove `bash` and expose the required built-ins and replacement tools.
3. Restart/start Pi; the no-bash startup gate checks that enforcement is active before protected agent work starts. Profile changes made during a live session require restart to take effect as a supported transition.
4. Optionally run `/nobash-status` to inspect current protection and tool availability.

**Acceptance:** Users cannot mistake installation of the package *without* the complementary tool-selection setting for a fully enabled no-bash profile.

### 3.4 Team/project flow

1. A maintainer commits a project `.pi/settings.json` containing both a pinned `packages` entry for `pi-nobash` and a `defaultTools` selection that removes `bash`.
2. A contributor pulls the project, starts Pi from that project, and approves the project trust request where applicable.
3. Pi loads the project package and tool selection; the startup gate establishes whether the profile is active.
4. The contributor uses the agent normally, without an additional manual per-person package/setup step **when the supported Pi version and trust settings make project activation work**.

**Scope:** Protection applies to Pi instances where this project profile is effective, not to all machine-wide sessions. A nested/headless Pi agent must be configured and verified independently.

### 3.5 Daily use

A user describes engineering work in natural language. The agent uses Pi's normal `read`, `grep`, `find`, `ls`, `edit`, and `write` tools where appropriate; uses typed tools for git, validation, and JSON/JSONL querying; and only uses approved restricted execution when a task has no suitable structured capability. Unsupported requests produce an explicit capability gap or denied-operation result.

### 3.6 Deactivation

To disable `pi-nobash`, remove/disable **both** the applicable package configuration and the `-bash` tool-selection setting, then restart and verify. Removing just the package can leave bash hidden; removing just `-bash` can leave the protective hook active. While the package remains available, `/nobash-status` must identify a detected partial configuration rather than report successful deactivation. Once the package is removed, its diagnostic command cannot be assumed to exist; use Pi configuration or external inspection to verify complete removal. Project-scoped changes must be committed for team-wide deactivation.

## 4. Product modes and permissions

| Mode | Target role | Normal capabilities | General process escape hatch |
|---|---|---|---|
| **Restricted** | Reviewers, analysts, planning peers | Read, search, bounded structured queries; optional safe computation | Not available |
| **Engineering (default)** | Coding/editing agents | Restricted capabilities plus authorized edits, typed git, named validation | Not available by default |
| **Escape-hatch** | Explicitly authorized debugging/migration agents | Engineering capabilities plus controlled `restricted_exec` | Audited, allowlisted, sandboxed |

Permissions apply per agent/session. The enforcement layer must prevent a restricted/read-only agent from invoking mutation or execution capabilities through alternate tools. Different modes must not be achieved solely by differing prompts.

**Escape-hatch authorization:** Availability of Escape-hatch mode must be explicitly enabled by a user or trusted project administrator through configuration. An agent may report a capability gap or request an authorized operation, but must not enable the mode, modify its own permissions, or approve its own elevation. Authorization mechanics for interactive and headless workflows remain an implementation question.

**Protected agent turn:** A turn in a Pi session for which the `pi-nobash` profile is configured or has been activated, even when a required protection fails to initialize. A missing or ineffective `-bash` setting does not redefine a claimed-protected turn as unprotected.

## 5. Functional tool requirements

### 5.1 Existing Pi primitives

| Requirement | Expected operation |
|---|---|
| **F1. Fixed-string search** | Use Pi `grep` with literal matching when regex is unnecessary |
| **F2. Regex search** | Use regex behavior only when requested/needed |
| **F3. File discovery and listing** | Use `find` and `ls` with correct path/ignore semantics |
| **F4. Targeted reading** | Use bounded `read` of a known file/range instead of wide scans |
| **F5. Editing** | Use authorized `edit`/`write`; enforce workspace/write permissions |

Do not force these primitives through a generic dispatcher when direct Pi invocation is simpler and at least as performant.

### 5.2 Structured capabilities

| Requirement | Model-facing capability | Minimum intended behavior |
|---|---|---|
| **F6. JSON/JSONL analysis** | `query_jsonl` / `json_query` | Filter, select/project, count/group/aggregate with typed parameters, bounded results, and streaming for large JSONL |
| **F7. Git** | Typed `git` operations | Read status/diff/log/show; explicit authorized add/commit and carefully scoped branch operations |
| **F8. Validation** | `run_validation` | Execute named, configured checks such as tests, lint, typecheck with timeout, cancellation and bounded output |
| **F9. Provider/model checks** | `check_model` | Resolve/check approved model identifiers and run bounded probes when permitted |
| **F10. Project-specific utilities** | Narrow tools where needed | `fallow`, `herdr`, rendering/conversion, and lifecycle operations only through explicit operations |
| **F11. Filesystem lifecycle** | Safe deletion/move/copy operations as required | Workspace-constrained, explicit targets, stricter controls for destructive effects |
| **F12. Escape hatch** | `restricted_exec` | Explicit executable/argument capability; no arbitrary shell expression; requires authorization, isolation and audit |
| **F13. Light glue** | Codemode where enabled | Bounded one-off transformations and composition of permitted operations; not the default bulk-data engine |

Tool names are product-level identifiers; the implementation specification will lock actual Pi registration names and schemas. No tool may take an unrestricted shell-command string as a substitute for its typed contract.

### 5.3 Semantic-operation contract

Each supported operation must state its intended meaning, typed input, permitted scope, effect class (read/write/process/network), output bounds, result/error semantics, and contract version. Unknown fields, invalid paths, unsupported operations, and exceeded resource budgets fail clearly.

The runtime, rather than the model, chooses implementation details such as native parsing vs streaming vs indexing, fixed arguments for Git, or the approved validation command. A backend change must preserve the operation's observable semantics and permissions.

### 5.4 Enforcement and diagnostics

**F14. Startup enforcement gate.** Before a protected agent turn, `pi-nobash` must check the required profile conditions: compatible runtime, effective tool exposure, registered/active enforcement policy, expected capabilities, and applicable mode/isolation prerequisites. A failed or unknown required condition must prevent protected agent work and surface a specific reason. The gate verifies enforcement presence (R2a), not universal runtime containment (R2b).

**F15. `/nobash-status` command.** The package must register a diagnostic command that distinguishes active, inactive, partial, failed, and unknown states where observable. It reports effective bash exposure, enforcement and compatibility checks, operating mode, available replacements, isolation verification, last startup-gate evaluation, and separately identified last adversarial-coverage evidence. An unverified condition must not display as passing. When the package itself is removed, this command is unavailable and cannot diagnose that state.

### 5.5 Coverage and unsupported intent

The initial coverage corpus includes the bash tasks observed in existing usage: Python JSON/JSONL manipulation, grep/ripgrep, file reads, tests/typechecks, Git, Pi probes, listings, filesystem operations, and small project-specific tooling. Each category must have a tested replacement or an explicitly constrained exception; unsupported cases cannot be counted as success.

The system must record a `CAPABILITY_GAP` (or equivalent structured event) for unmet legitimate intent, not just count denied bash invocations. A model that no longer sees bash may never attempt a bash call, so zero denials alone is not a coverage metric.

## 6. Security requirements

### 6.1 Three independent defense layers

**Layer 1: capability design.** Do not expose general-purpose shell/interpreter execution when a narrow operation meets the need. **Layer 2: policy enforcement.** Enforce agent, operation, path, argument, environment, time, output and effect permissions for direct and composed operations. **Layer 3: OS/container/VM isolation.** Bound the real damage an executable or repository-controlled script can do, even after a valid semantic request.

### 6.2 R2a — enforcement-presence gate (startup)

**S1.** Before the first **protected agent turn** (as defined in Section 4), establish at minimum:

- Supported running Pi version and necessary APIs.
- `bash` absent from the effective model-facing active toolset.
- The `pi-nobash` tool-call enforcement hook registered/active, not just present in a manifest.
- Expected replacement tools and policy configuration available.
- Required protection for the requested operating mode and execution environment can be established.

**S2.** When a required condition cannot be established, **fail closed**: the system must not allow a protected agent to continue silently with unrestricted execution. The exact supported Pi mechanism for aborting, refusing a turn, or blocking all tools is an **open technical feasibility question** and must be verified before implementation commits to a startup design.

**S2a. Mid-session policy.** Profile changes made during a live session require a restart for supported activation/deactivation or policy changes. The startup gate establishes the last verified profile state; the system must not silently weaken enforcement after that evaluation. If an invalid or weakened required condition becomes known during a protected session, subsequent protected turns must be blocked until the protection is re-established. Detection of all external file/package changes is not assumed and must be assessed technically.

**S3.** A green startup gate only proves stated enforcement-presence checks. It must **not** claim that every execution path is contained.

**S4.** Any new Pi process (including separately launched SDK/headless peers) claiming `pi-nobash` protection must satisfy its own startup gate.

### 6.3 R2b — enforcement-coverage gate (runtime)

**S5.** Verify that protected execution cannot evade policy by composition or routing, including:

- Direct `bash` calls and alternate generic process tools.
- Agent-authored script combined with any allowed interpreter or launcher.
- Nested tools and direct `.execute()` paths that might evade normal interception.
- Extension-internal Node/process execution outside normal Pi tool hooks.
- Repository-controlled npm/build/test/lint hooks invoked by approved validation operations.
- Path traversal, symlinks, out-of-workspace reads/writes, and unauthorized data disclosure.
- Prompt injection through repositories, logs, documentation or other untrusted tool output.

**S6.** The adversarial regression suite must test **combinations** of capabilities and run whenever a tool, allowlist, backend, policy, or execution environment changes. Runtime containment must be demonstrated under the intended sandbox policy, not inferred from `getActiveTools()`.

### 6.4 Policy and isolation behavior

**S7.** Default-deny any unsupported operation and disallow uncontrolled interpreter execution. Process operations use narrow, validated parameters and resource limits. A nominally read-only tool cannot secretly mutate state.

**S8.** Execution-capable workflows run in an approved isolated workspace with limited accessible data/credentials. The ideal recoverable failure is damage to a disposable checkout, not the user's home directory or unrelated repositories.

**S9.** Installation of a Pi package is itself a trust boundary: packages/extensions may execute privileged code before runtime tool policy protects agent calls. Installation instructions must require trusted/pinned sources and must not present package delivery as containment.

## 7. Status, errors, and observability

### 7.1 `/nobash-status`

The product registers `/nobash-status` as its own diagnostic command. It must report separately:

- Current installation/profile scope and relevant Pi compatibility status.
- Effective model-facing tool availability, including whether `bash` is exposed.
- Startup gate state: pass/fail/unknown and the failed checks, including policy hook status and time/phase of the last evaluation.
- Profile activation state: active, inactive, partial, failed or unknown where it can be determined; detected configuration drift must not appear as a clean pass.
- Current operating mode and available structured capabilities.
- Configured isolation mode and whether activation is verified or unverified.
- Runtime coverage evidence, if available: the **last tested** adversarial suite/build, not a claim of universal security.

Unknown or unverified values must never be displayed as passing. The command is diagnostic, not proof that all execution paths are safe.

### 7.2 Errors and telemetry

**O1.** Structured failure classes: permission denied, unsupported capability, invalid request, workspace violation, timeout/cancellation, truncated output, execution failure, startup enforcement failure, backend incompatibility.

**O2.** For each meaningful operation capture, where supported: operation, backend, policy decision, agent/run identity, elapsed time, input/output bytes, records scanned/returned, cache hit, exit/error class, and truncation.

**O3.** Redact or omit secrets and unnecessary raw arguments. Return compact results and bounded diagnostics rather than dumping arbitrary process output or sensitive data into model context/logs.

**O4.** Unmet intents, restricted execution requests, enforcement failures and denied calls must be visible for coverage analysis and operational diagnosis.

## 8. Performance requirements

**P1. End-to-end objective.** Optimize task completion, correctness, total elapsed time, model turns, tokens and memory, not subprocess speed alone.

**P2. Appropriate implementations.** Prefer existing optimized Pi search/read tools. For large one-pass JSONL, prefer streaming and early filter/projection. For repeated queries over stable files, introduce caching/indexing only if measured savings exceed preparation/invalidation costs. Codemode is for modest one-off glue.

**P3. Output efficiency.** Structured queries and validations must support bounded results, relevant field projection and explicit truncation metadata. A correct aggregate/count should not require returning all source records to the model.

**P4. Reproducible benchmarks.** Compare baseline bash-enabled and new-tool implementations on equivalent tasks, repository snapshots, hardware, model settings and outputs; measure repeated runs, median and tail latency, token cost, peak memory where available, success rate and correctness.

**P5. No semantic degradation for speed.** An alternative backend must not alter ordering, matching, case/null/numeric behavior, path policy or authorization silently. Cache invalidation and output correctness outrank superficial acceleration.

**P6. Optimization acceptance.** Promote a backend optimization only when it preserves correctness and permissions and provides repeatable meaningful benefit on representative workloads. Do not assert that every new tool is faster.

No numerical performance targets are asserted before baselines are measured. Target thresholds will be set from the first paired benchmark corpus and tracked as release criteria.

## 9. Product acceptance criteria

A v1.0 release is acceptable only when each class is independently demonstrated:

| ID | Acceptance gate | Demonstration required |
|---|---|---|
| **AC1** | Activation | Solo and trusted-project flows install/activate appropriate settings and package resources on supported Pi versions |
| **AC2** | Tool removal | `pi.getActiveTools()` shows built-in `bash` absent under the normal protected profile; executable blocking is tested separately |
| **AC3** | Interception | Deliberately re-exposed bash calls are blocked before executing |
| **AC4** | Fail-closed startup (R2a) | Missing package, inactive hook, incompatible Pi, or ineffective settings cannot result in a silently unprotected *claimed-protected* session |
| **AC5** | Runtime security (R2b) | Adversarial composition/bypass cases are blocked or isolated with verified expected outcomes |
| **AC6** | Engineering coverage | Representative read/search/edit/JSONL/git/validation tasks complete without unrestricted bash; gaps are explicitly recorded |
| **AC7** | Read-only permissions | Restricted roles cannot mutate files or execute general processes through permitted tools |
| **AC8** | Isolation | Execution-capable tools cannot access prohibited host paths/secrets beyond configured containment |
| **AC9** | Semantic correctness | Differential fixtures pass for supported operations/backends, including malformed input and boundary cases |
| **AC10** | Performance | Paired benchmark report demonstrates end-to-end impact; material regressions are identified and accepted or fixed |
| **AC11** | Diagnostics | `/nobash-status` uses `pi.getActiveTools()` for exposure status and distinguishes hook presence, partial/failed profile state, last gate evaluation, isolation verification and last coverage-test evidence |
| **AC12** | Deactivation | Full package/settings removal followed by restart restores documented normal behavior; detected partial deactivation is explicitly reported by `/nobash-status` when the package is available, never labeled fully off |
| **AC13** | Headless/peers | Every separately launched agent claiming protection passes its own startup and role/permission checks |
| **AC14** | Mid-session change | Activation/deactivation changes require restart; known loss of enforcement blocks subsequent protected turns and status reflects last gate evaluation |
| **AC15** | Escape-hatch authorization | No agent can self-enable Escape-hatch mode, modify its own permissions, or self-approve escalation |

Intentional safety refusals are not capability failures. A task that simply cannot be expressed by supported operations must produce a clear gap rather than being marked complete.

## 10. Release scope and order

**Release foundation:** packaging/settings integration; direct Pi primitives; removal plus bash-block hook; startup gate; `/nobash-status`; restricted operating mode; telemetry for denials/capability gaps.

**Engineering capability:** streaming JSONL query, typed Git, named validation, authorization, bounded execution and sandbox routing; then additional typed project utilities driven by observed demand.

**Verification:** differential functional tests, adversarial capability-composition tests, solo/team/headless activation tests, benchmark comparison, and documented handling for unmet intents.

These are product milestones, not a prescriptive SDK implementation sequence. A release cannot claim protected operation until R2a and R2b gates are met at the applicable scope.

## 11. Open implementation questions (must not be presented as solved)

- **Q1 — Fail-closed mechanism:** Which supported Pi extension/API behavior can reliably stop a protected session or reject the first agent turn when the startup gate is red? Throwing at load, blocking all tools/turns, or explicit refusal must be tested. Extension-load errors that merely skip the extension would be unacceptable as the sole gate.
- **Q2 — Effective activation:** Precisely when do project settings, package auto-install, trust approval, hook registration, and active tool selection take effect, and in what order? Verify interactive and SDK/headless paths.
- **Q3 — Hook presence:** Can the extension positively attest hook registration/effectiveness at startup, or is a controlled canary test required? Merely defining a handler is insufficient evidence.
- **Q4 — Version contract:** What exact runtime compatibility check and host-provided `@earendil-works/*` peer dependency declarations are required by the targeted Pi release? Pi 0.84.2 fixed `defaultTools` dropping extension/SDK custom tools when selecting built-in defaults. The product needs both `-bash` removal and coexisting registered replacement tools; verify the version floor and actual package behavior.
- **Q5 — Isolation:** Which Pi execution environment and OS boundary meets the required containment on each supported development platform?
- **Q6 — Escape-hatch policy:** Who authorizes exceptional execution in interactive versus headless workflows, and which operations are initially permitted?
- **Q7 — Success thresholds:** What task-coverage and performance targets are justified by representative baseline runs?
- **Q8 — Mid-session change detection:** Which supported Pi mechanisms can detect changes to effective tool selection, package resources, or policy during a live session? How can the gate invalidate a previously verified state without relying on unverified hot reload behavior?

These are requirements or feasibility questions for the **Technical Implementation Specification**, not grounds to weaken this product's protection claims.

## 12. Final product rule

**`pi-nobash` may claim “bash removed” only when effective tool selection verifies that claim. It may claim “protected execution” only when startup enforcement (R2a), runtime coverage and isolation (R2b) are independently verified for the running agent.**
